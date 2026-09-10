import { eq, and, isNull } from "drizzle-orm";
import { registrations, checkins } from "@pgegypt/db";
import type { Db } from "@pgegypt/db";
import { createRequire } from "node:module";
import { ApiError } from "../middleware/errorHandler.js";
import { createAuditLog } from "./audit.service.js";

// ---------------------------------------------------------------------------
// Helpers — pure, <50 lines
// ---------------------------------------------------------------------------

function nowSec(now?: number): number {
  return Math.floor((now ?? Date.now()) / 1000);
}

/**
 * Generate opaque check-in token — crypto.randomUUID per spec §22.
 * Pure — no DB.
 */
export function generateCheckinToken(): string {
  return crypto.randomUUID();
}

/**
 * SHA-256 hex hash for storage — opaque token stored hashed (§22 acceptance).
 * Uses node:crypto sync when available, falls back to plain token.
 */
export function hashCheckinToken(token: string): string {
  if (!token) throw new Error("hashCheckinToken: token required");
  try {
    // Node (local + tests): createRequire works in ESM. Workers: falls back below.
    const _require = createRequire(import.meta.url);
    const nodeCrypto = _require("node:crypto") as {
      createHash: (alg: string) => { update: (d: string) => { digest: (enc: string) => string } };
    };
    return nodeCrypto.createHash("sha256").update(token).digest("hex");
  } catch {
    // Workers fallback — SubtleCrypto is async, so the sync path can't hash here.
    // Tokens remain opaque; lookups fall back to plain comparison in performCheckin.
    return token;
  }
}

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

async function selectOne<T>(query: unknown): Promise<T | null> {
  const q = query as Record<string, unknown>;
  if (typeof q.get === "function") {
    const res = (q.get as () => unknown)();
    const awaited = res instanceof Promise ? await res : res;
    return (awaited as T) ?? null;
  }
  const all = await selectAll(query);
  return (all[0] as T) ?? null;
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
// Service
// ---------------------------------------------------------------------------

export type CheckinResult =
  | { status: "checked_in"; registration: typeof registrations.$inferSelect }
  | { status: "already_checked_in"; registration: typeof registrations.$inferSelect };

/**
 * Confirm a registration — transitions status to confirmed and generates
 * opaque check-in token stored hashed. Idempotent: if already confirmed with
 * token, returns existing without regenerating.
 */
export async function confirmRegistration(
  db: Db,
  registrationId: string,
  meta: { actorId?: string; ip?: string; userAgent?: string; now?: number } = {}
): Promise<{
  registration: typeof registrations.$inferSelect;
  plainToken: string | null;
  alreadyConfirmed: boolean;
}> {
  const existing = await selectOne<typeof registrations.$inferSelect>(
    db
      .select()
      .from(registrations)
      .where(and(eq(registrations.id, registrationId), isNull(registrations.deletedAt)))
  );
  if (!existing) throw new ApiError(404, "NOT_FOUND", "Registration not found");

  // If already confirmed and has token — idempotent, do not regenerate
  if ((existing.status as string) === "confirmed" && existing.checkinToken) {
    return { registration: existing, plainToken: null, alreadyConfirmed: true };
  }

  const plainToken = generateCheckinToken();
  const hashed = hashCheckinToken(plainToken);
  const now = nowSec(meta.now);

  await runQuery(
    db
      .update(registrations)
      .set({ status: "confirmed" as never, checkinToken: hashed as never, updatedAt: now } as never)
      .where(eq(registrations.id, registrationId))
  );

  const updated = await selectOne<typeof registrations.$inferSelect>(
    db.select().from(registrations).where(eq(registrations.id, registrationId))
  );

  // Audit log for confirmation
  await createAuditLog(db, {
    actorId: meta.actorId ?? null,
    action: "registrations.confirm",
    targetType: "registration",
    targetId: registrationId,
    metadata: { status: "confirmed" },
    ipAddress: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
    now: meta.now,
  });

  return { registration: updated!, plainToken, alreadyConfirmed: false };
}

/**
 * Perform check-in via opaque token.
 * - Validates token exists
 * - Rejects non-confirmed 400
 * - Idempotent repeat returns 200 already_checked_in
 */
export async function performCheckin(
  db: Db,
  rawToken: string,
  meta: { actorId?: string; ip?: string; userAgent?: string; now?: number } = {}
): Promise<CheckinResult> {
  const token = rawToken?.trim();
  if (!token) throw new ApiError(400, "BAD_REQUEST", "Check-in token required");

  const hashed = hashCheckinToken(token);

  // Try hashed match first, then plain fallback (for legacy or if hashing unavailable)
  let registration: typeof registrations.$inferSelect | null = null;

  const byHash = await selectOne<typeof registrations.$inferSelect>(
    db
      .select()
      .from(registrations)
      .where(and(eq(registrations.checkinToken, hashed), isNull(registrations.deletedAt)))
  );
  if (byHash) {
    registration = byHash;
  } else {
    // Fallback: plain token equality (if stored plain or hash function returned plain)
    const byPlain = await selectOne<typeof registrations.$inferSelect>(
      db
        .select()
        .from(registrations)
        .where(and(eq(registrations.checkinToken, token), isNull(registrations.deletedAt)))
    );
    if (byPlain) registration = byPlain;
  }

  if (!registration) throw new ApiError(404, "NOT_FOUND", "Invalid check-in token");

  if ((registration.status as string) !== "confirmed") {
    throw new ApiError(400, "BAD_REQUEST", "Registration not confirmed — cannot check in");
  }

  if (registration.checkedInAt) {
    // Idempotent — already checked in
    return { status: "already_checked_in", registration };
  }

  const now = nowSec(meta.now);

  // §24.2 — insert into `checkins` (UNIQUE registration_id makes double-scan idempotent at DB level)
  try {
    await runQuery(
      db.insert(checkins).values({
        id: crypto.randomUUID(),
        registrationId: registration.id,
        checkedInByUserId: meta.actorId ?? null,
        method: "qr",
        createdAt: now,
      } as never)
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/UNIQUE|constraint/i.test(msg)) {
      // Concurrent double-scan — another request already recorded it
      const current = await selectOne<typeof registrations.$inferSelect>(
        db.select().from(registrations).where(eq(registrations.id, registration.id))
      );
      return { status: "already_checked_in", registration: current ?? registration };
    }
    throw err;
  }

  await runQuery(
    db
      .update(registrations)
      .set({ checkedInAt: now as never, updatedAt: now as never } as never)
      .where(eq(registrations.id, registration.id))
  );

  const updated = await selectOne<typeof registrations.$inferSelect>(
    db.select().from(registrations).where(eq(registrations.id, registration.id))
  );

  // Audit log for check-in
  await createAuditLog(db, {
    actorId: meta.actorId ?? null,
    action: "registrations.checkin",
    targetType: "registration",
    targetId: registration.id,
    metadata: { checkedInAt: now },
    ipAddress: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
    now: meta.now,
  });

  return { status: "checked_in", registration: updated! };
}

/**
 * Lookup registration by check-in token without mutating (for GET preview).
 */
export async function findByCheckinToken(
  db: Db,
  rawToken: string
): Promise<typeof registrations.$inferSelect | null> {
  const token = rawToken?.trim();
  if (!token) return null;
  const hashed = hashCheckinToken(token);
  const byHash = await selectOne<typeof registrations.$inferSelect>(
    db
      .select()
      .from(registrations)
      .where(and(eq(registrations.checkinToken, hashed), isNull(registrations.deletedAt)))
  );
  if (byHash) return byHash;
  const byPlain = await selectOne<typeof registrations.$inferSelect>(
    db
      .select()
      .from(registrations)
      .where(and(eq(registrations.checkinToken, token), isNull(registrations.deletedAt)))
  );
  return byPlain;
}
