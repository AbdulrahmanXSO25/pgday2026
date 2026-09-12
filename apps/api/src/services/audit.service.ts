import type { Db } from "@pgegypt/db";
import { auditLogs } from "@pgegypt/db";

// ---------------------------------------------------------------------------
// PII redaction — §32, security-patterns
// Redacts keys: email, password, token, checkin_token, checkinToken, etc.
// Also redacts email-like strings in values.
// Never log raw PII; metadata stored as JSON string with [REDACTED] placeholders.
// ---------------------------------------------------------------------------

const SENSITIVE_KEYS = new Set([
  "email",
  "submitter_email",
  "submitterEmail",
  "password",
  "password_hash",
  "passwordHash",
  "token",
  "checkin_token",
  "checkinToken",
  "authorization",
  "cookie",
]);

const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/**
 * Deep redaction — pure function.
 * Replaces sensitive key values and email patterns in strings.
 */
export function redactValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    // Redact email patterns
    if (EMAIL_REGEX.test(value)) return "[REDACTED_EMAIL]";
    // Reset regex lastIndex
    EMAIL_REGEX.lastIndex = 0;
    return value;
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redactValue);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const lower = k.toLowerCase();
    if (SENSITIVE_KEYS.has(k) || SENSITIVE_KEYS.has(lower)) {
      out[k] = "[REDACTED]";
    } else if (typeof v === "string" && EMAIL_REGEX.test(v)) {
      EMAIL_REGEX.lastIndex = 0;
      out[k] = "[REDACTED_EMAIL]";
    } else if (typeof v === "object" && v !== null) {
      out[k] = redactValue(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Redact metadata object and stringify for storage.
 * Pure — no DB access.
 */
export function serializeMetadata(
  metadata: Record<string, unknown> | null | undefined
): string | null {
  if (!metadata) return null;
  try {
    const redacted = redactValue(metadata) as Record<string, unknown>;
    return JSON.stringify(redacted);
  } catch {
    return JSON.stringify({ redacted: "[REDACTED]" });
  }
}

// ---------------------------------------------------------------------------
// DB helpers — handle better-sqlite3 sync vs D1 async
// ---------------------------------------------------------------------------

async function selectAll(query: unknown): Promise<unknown[]> {
  const q = query as Record<string, unknown>;
  if (typeof q.all === "function") {
    const res = (q.all as () => unknown)();
    const awaited = res instanceof Promise ? await res : res;
    if (Array.isArray(awaited)) return awaited;
    if (
      awaited &&
      typeof awaited === "object" &&
      "results" in (awaited as Record<string, unknown>)
    ) {
      return ((awaited as Record<string, unknown>).results as unknown[]) ?? [];
    }
    return Array.isArray(awaited) ? awaited : [];
  }
  const res = await (query as Promise<unknown>);
  if (Array.isArray(res)) return res;
  if (res && typeof res === "object" && "results" in (res as Record<string, unknown>)) {
    return ((res as Record<string, unknown>).results as unknown[]) ?? [];
  }
  return [];
}

async function runQuery(query: unknown): Promise<void> {
  const q = query as Record<string, unknown>;
  if (typeof q.run === "function") {
    const res = (q.run as () => unknown)();
    if (res instanceof Promise) await res;
    return;
  }
  await (query as Promise<unknown>);
}

// ---------------------------------------------------------------------------
// Service — DI via db, explicit errors, no globals
// ---------------------------------------------------------------------------

export type AuditLogInput = {
  actorId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  now?: number;
};

function nowSec(now?: number): number {
  return Math.floor((now ?? Date.now()) / 1000);
}

/**
 * Create audit log entry with PII redaction.
 * Returns inserted id.
 */
export async function createAuditLog(db: Db, input: AuditLogInput): Promise<{ id: string }> {
  const id = crypto.randomUUID();
  const created = nowSec(input.now);
  const metadataStr = serializeMetadata(input.metadata ?? null);

  const resolvedActorId: string | null = input.actorId ?? null;

  try {
    await runQuery(
      (db as unknown as { insert: (t: unknown) => { values: (v: unknown) => unknown } })
        .insert(auditLogs)
        .values({
          id,
          actorId: resolvedActorId,
          action: input.action,
          targetType: input.targetType,
          targetId: input.targetId ?? null,
          metadata: metadataStr,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
          createdAt: created,
        } as never)
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("FOREIGN KEY") && resolvedActorId) {
      await runQuery(
        (db as unknown as { insert: (t: unknown) => { values: (v: unknown) => unknown } })
          .insert(auditLogs)
          .values({
            id,
            actorId: null,
            action: input.action,
            targetType: input.targetType,
            targetId: input.targetId ?? null,
            metadata: metadataStr,
            ipAddress: input.ipAddress ?? null,
            userAgent: input.userAgent ?? null,
            createdAt: created,
          } as never)
      );
    } else {
      throw err;
    }
  }

  return { id };
}

/**
 * List audit logs — latest first, paginated.
 * SUPER_ADMIN only enforced at route layer.
 */
export async function listAuditLogs(
  db: Db,
  opts: {
    limit?: number;
    offset?: number;
    actorId?: string;
    targetType?: string;
    from?: number;
    to?: number;
  } = {}
): Promise<{ rows: Array<typeof auditLogs.$inferSelect>; total: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);

  // Fetch all (small table) then filter + paginate in JS for portability
  // across better-sqlite3/D1 (avoids drizzle dialect differences).
  const rows = (await selectAll(
    (db as unknown as { select: () => { from: (t: unknown) => unknown } }).select().from(auditLogs)
  )) as Array<typeof auditLogs.$inferSelect>;

  const actorId = opts.actorId?.trim();
  const targetType = opts.targetType?.trim();
  const from = opts.from;
  const to = opts.to;

  const filtered = rows.filter((r) => {
    if (actorId && (r.actorId as string | null) !== actorId) return false;
    if (targetType && (r.targetType as string | null) !== targetType) return false;
    const ts = r.createdAt as number;
    if (from != null && ts < from) return false;
    if (to != null && ts > to) return false;
    return true;
  });

  filtered.sort((a, b) => (b.createdAt as number) - (a.createdAt as number));
  return { rows: filtered.slice(offset, offset + limit), total: filtered.length };
}
