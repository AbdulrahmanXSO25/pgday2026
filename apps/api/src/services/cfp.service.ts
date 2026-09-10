import type { Db } from "@pgegypt/db";
import { ApiError } from "../middleware/errorHandler.js";
import {
  DEFAULT_EVENT_ID,
  findEventById,
  checkCfpRateLimit,
  createCfpSubmissionTransactional,
  listCfpBySubmitterEmail,
} from "../repositories/cfp.repo.js";
import type { CfpSubmissionPayload, CfpMineQueryPayload } from "@pgegypt/validation";
import { normalizeCfpPayload, normalizeCfpMineQuery } from "@pgegypt/validation";

// ---------------------------------------------------------------------------
// Helpers — pure, <50 lines
// ---------------------------------------------------------------------------
function resolveEventId(payload: CfpSubmissionPayload): string {
  const maybe = (payload.eventId ?? payload.event_id) as string | undefined;
  if (typeof maybe === "string" && maybe.trim().length > 0) return maybe.trim();
  return DEFAULT_EVENT_ID;
}

function resolveMineEventId(payload: CfpMineQueryPayload): string | undefined {
  const maybe = (payload.eventId ?? payload.event_id) as string | undefined;
  if (typeof maybe === "string" && maybe.trim().length > 0) return maybe.trim();
  return undefined;
}

// ---------------------------------------------------------------------------
// Service — composition, DI, explicit errors
// ---------------------------------------------------------------------------

export type CfpServiceOptions = {
  db: Db;
  now?: number;
  /** Best-effort email enqueue (§19.1) — failure never fails the submission */
  queue?: { enqueue: (job: Record<string, unknown>) => Promise<void> } | null;
  mailer?: {
    send: (payload: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
  } | null;
};

/**
 * Create CFP submission — validates event, rate limit, email normalization,
 * transactionally writes cfp_submissions + cfp_submission_speakers with status submitted.
 */
export async function createCfpSubmission(
  options: CfpServiceOptions,
  payload: CfpSubmissionPayload,
  ip: string
): Promise<{ id: string; email: string; eventId: string }> {
  const { db, now } = options;
  const nowMs = now ?? Date.now();

  // 1) Resolve & validate event
  const eventId = resolveEventId(payload);
  const event = await findEventById(db, eventId);
  if (!event) {
    throw new ApiError(404, "NOT_FOUND", `Event ${eventId} not found`);
  }

  // 2) Rate limit — 5/hour per IP anonymous (§34)
  const limited = await checkCfpRateLimit(db, ip, nowMs);
  if (limited) {
    throw new ApiError(429, "RATE_LIMITED", "Too many CFP submissions. Please try again later.");
  }

  // 3) Normalize payload (aliases, trim, lowercase emails)
  const normalized = normalizeCfpPayload(payload);

  // 4) Prepare speakers — primary + coSpeakers transactional
  const id = crypto.randomUUID();
  const primarySpeaker = {
    id: crypto.randomUUID(),
    name: normalized.submitterName,
    email: normalized.submitterEmail,
    bio: normalized.submitterBio,
    company: undefined as string | undefined,
    role: undefined as string | undefined,
    isPrimary: 1,
  };

  const coSpeakerRows = normalized.coSpeakers.map((s) => ({
    id: crypto.randomUUID(),
    name: s.name.trim(),
    email: s.email.trim().toLowerCase(),
    bio: s.bio,
    company: s.company,
    role: s.role,
    isPrimary: 0,
  }));

  // Ensure no duplicate email between primary and coSpeakers (case-insensitive)
  // Pure filtering — if coSpeaker email matches primary, drop duplicate
  const dedupedCoSpeakers = coSpeakerRows.filter(
    (cs) => cs.email.toLowerCase() !== primarySpeaker.email.toLowerCase()
  );

  const allSpeakers = [primarySpeaker, ...dedupedCoSpeakers];

  // 5) Transactional insert — status always submitted (transitions only via review)
  try {
    await createCfpSubmissionTransactional(db, {
      id,
      eventId,
      title: normalized.title,
      abstract: normalized.abstract,
      track: normalized.track,
      level: normalized.level,
      status: "submitted",
      submitterName: normalized.submitterName,
      submitterEmail: normalized.submitterEmail,
      submitterBio: normalized.submitterBio,
      speakers: allSpeakers,
    });
  } catch (error) {
    // Unexpected DB error — log without PII, return 500
    const msg = error instanceof Error ? error.message : String(error);
    // Avoid leaking submitter email in log
    console.error("[cfp] create submission failed:", msg.slice(0, 200));
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      500,
      "INTERNAL_ERROR",
      "Something went wrong. Please try again in a moment."
    );
  }

  // §19.1 — best-effort "submission received" email (never fails the request, §18.5 principle)
  void (async () => {
    try {
      const subject = `We received your talk proposal: ${normalized.title}`;
      const html = `<p>Hi ${normalized.submitterName},</p><p>Thanks for submitting <strong>${normalized.title}</strong> to PG Day Egypt 2026. Our program committee will review it and get back to you at this address.</p>`;
      const text = `Thanks for submitting "${normalized.title}" to PG Day Egypt 2026. Our program committee will review it and get back to you.`;
      const job = {
        to: normalized.submitterEmail,
        subject,
        html,
        text,
        type: "cfp_submission_received",
        idempotencyKey: `cfp-received:${id}`,
      };
      if (options.queue && typeof options.queue.enqueue === "function") {
        await options.queue.enqueue(job);
      } else if (options.mailer && typeof options.mailer.send === "function") {
        const res = await options.mailer.send(job);
        if (!res.ok)
          console.error("[cfp] submission-received email failed (non-fatal):", res.error);
      }
    } catch (err) {
      console.error(
        "[cfp] submission-received email failed (non-fatal):",
        err instanceof Error ? err.message : String(err)
      );
    }
  })();

  return { id, email: normalized.submitterEmail, eventId };
}

/**
 * List mine — filters by submitter email (auth-lite public).
 * Validates eventId if provided.
 */
export async function listMine(
  db: Db,
  query: CfpMineQueryPayload
): Promise<Array<Record<string, unknown>>> {
  const normalized = normalizeCfpMineQuery(query);
  const email = normalized.email;

  // Validate eventId if provided
  if (normalized.eventId) {
    const ev = await findEventById(db, normalized.eventId);
    if (!ev) throw new ApiError(404, "NOT_FOUND", `Event ${normalized.eventId} not found`);
  }

  const rows = await listCfpBySubmitterEmail(db, {
    email,
    eventId: normalized.eventId,
    limit: normalized.limit,
    offset: normalized.offset,
  });

  return rows as unknown as Array<Record<string, unknown>>;
}
