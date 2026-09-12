import type { Db } from "@pgegypt/db";
import { ApiError } from "../middleware/errorHandler.js";
import {
  DEFAULT_EVENT_ID,
  findEventById,
  findRegistrationByEventEmail,
  insertRegistration,
  isUniqueViolation,
  checkRateLimit,
  listRegistrations as repoList,
} from "../repositories/registration.repo.js";
import type { RegistrationPayload } from "@pgegypt/validation";

// ---------------------------------------------------------------------------
// Types — explicit dependencies via DI
// ---------------------------------------------------------------------------
export type QueueAdapter = {
  enqueue?(payload: unknown): Promise<string>;
};

export type MailerAdapter = {
  send?(payload: {
    to: string;
    subject: string;
    html: string;
    text?: string;
  }): Promise<{ ok: boolean; error?: string }>;
};

export type RegistrationServiceOptions = {
  db: Db;
  queue?: QueueAdapter | null;
  mailer?: MailerAdapter | null;
  now?: number;
};

// ---------------------------------------------------------------------------
// Helpers — pure functions, <50 lines
// ---------------------------------------------------------------------------

function friendlyDuplicateMessage(email: string): string {
  return `Looks like ${email} is already registered. You're all set — we'll be in touch closer to the event.`;
}

function resolveEventId(payload: RegistrationPayload): string {
  const maybe =
    (payload as Record<string, unknown>).eventId ?? (payload as Record<string, unknown>).event_id;
  if (typeof maybe === "string" && maybe.trim().length > 0) return maybe.trim();
  return DEFAULT_EVENT_ID;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Service — composition of pure + DB operations, DI, explicit errors
// ---------------------------------------------------------------------------

/**
 * Create a registration — validates event, rate limit, duplicate pre-check + DB constraint, best-effort email.
 * Throws ApiError with appropriate status/code for route layer to map.
 */
export async function createRegistration(
  options: RegistrationServiceOptions,
  payload: RegistrationPayload,
  ip: string
): Promise<{ id: string; email: string; eventId: string }> {
  const { db, queue, mailer, now } = options;
  const nowMs = now ?? Date.now();

  // 1) Resolve and validate event
  const eventId = resolveEventId(payload);
  const event = await findEventById(db, eventId);
  if (!event) {
    throw new ApiError(404, "NOT_FOUND", `Event ${eventId} not found`);
  }

  // 2) Rate limit — 5/hour per IP via rate_limits table
  const limited = await checkRateLimit(db, ip, nowMs);
  if (limited) {
    throw new ApiError(
      429,
      "RATE_LIMITED",
      "Too many registration attempts. Please try again later."
    );
  }

  // 3) Normalize
  const email = normalizeEmail(payload.email);
  const name = payload.name.trim();

  // 4) Pre-check duplicate (friendly 409)
  const existing = await findRegistrationByEventEmail(db, eventId, email);
  if (existing) {
    throw new ApiError(409, "CONFLICT", friendlyDuplicateMessage(email));
  }

  // 5) Insert — catch UNIQUE(event_id,email) race (parallel inserts)
  const id = crypto.randomUUID();
  try {
    await insertRegistration(db, {
      id,
      eventId,
      name,
      email,
      organization: payload.organization,
      role: payload.role,
      dietaryNotes: payload.dietaryNotes,
      status: "pending",
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ApiError(409, "CONFLICT", friendlyDuplicateMessage(email));
    }
    // Log without leaking PII email to stdout? Keep minimal — do not log email.
    console.error(
      "[registrations] insert failed:",
      error instanceof Error ? error.message : String(error)
    );
    throw new ApiError(
      500,
      "INTERNAL_ERROR",
      "Something went wrong. Please try again in a moment."
    );
  }

  // 6) Best-effort email — never fail registration if email fails (in-process queue local)
  // Fire-and-forget: do not await rejection
  void (async () => {
    try {
      const job = {
        type: "registration_thank_you" as const,
        to: email,
        name,
        eventId,
      };
      if (queue && typeof queue.enqueue === "function") {
        await queue.enqueue(job);
      } else if (mailer && typeof mailer.send === "function") {
        // Direct-mailer fallback (no queue) — build the template inline
        const { buildRegistrationReceivedEmail } = await import("@pgegypt/mail");
        const siteUrl = process.env.SITE_URL ?? "https://2026day.pgegypt.org";
        const tpl = buildRegistrationReceivedEmail({ name, siteUrl });
        const res = await mailer.send({
          to: email,
          subject: tpl.subject,
          html: tpl.html,
          text: tpl.text,
        });
        if (!res.ok)
          console.error("[registrations] thank-you email failed (non-fatal):", res.error);
      } else {
        // No queue/mailer injected — noop for tests
      }
    } catch (err) {
      console.error(
        "[registrations] thank-you email failed (non-fatal):",
        err instanceof Error ? err.message : String(err)
      );
    }
  })();

  return { id, email, eventId };
}

/**
 * List registrations — admin, ordered latest first.
 */
export async function listRegistrations(
  db: Db,
  query: {
    eventId?: string;
    event_id?: string;
    status?: string;
    limit?: string;
    offset?: string;
  } = {}
): Promise<Array<Record<string, unknown>>> {
  const eventId = (query.eventId ?? query.event_id) as string | undefined;
  const status = query.status as string | undefined;
  const limit = query.limit ? Number(query.limit) : undefined;
  const offset = query.offset ? Number(query.offset) : undefined;

  // Validate eventId if provided
  if (eventId) {
    const ev = await findEventById(db, eventId);
    if (!ev) throw new ApiError(404, "NOT_FOUND", `Event ${eventId} not found`);
  }

  const rows = await repoList(db, {
    eventId,
    status,
    limit: Number.isFinite(limit as number) ? (limit as number) : undefined,
    offset: Number.isFinite(offset as number) ? (offset as number) : undefined,
  });

  // Strip internal columns? Return as-is but ensure soft-delete not exposed via row selection already filtered
  return rows as unknown as Array<Record<string, unknown>>;
}
