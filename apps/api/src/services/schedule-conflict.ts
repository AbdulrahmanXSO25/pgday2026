import { and, eq, isNull, ne, inArray, lt, gt } from "drizzle-orm";
import { sessions, sessionSpeakers } from "@pgegypt/db";
import type { Db } from "@pgegypt/db";
import { ApiError } from "../middleware/errorHandler.js";

/**
 * Schedule conflict detection — §24
 * Same room overlapping time → 409 Conflict
 * Validates start<end ISO or unix seconds.
 */

// ---------------------------------------------------------------------------
// Helpers — pure functions, <50 lines
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

/**
 * Parse ISO to epoch seconds — pure.
 * Returns epoch or null if invalid.
 */
export function parseIsoToEpoch(iso: string): number | null {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return null;
  return Math.floor(ts / 1000);
}

/**
 * Validate start<end for ISO or epoch — pure.
 * Throws ApiError 422 if invalid.
 * Returns normalized epoch pair or null if no times.
 */
export function validateAndNormalizeTimes(input: {
  startsAt?: string | null;
  endsAt?: string | null;
  startsAtEpoch?: number | null;
  endsAtEpoch?: number | null;
}): {
  startsAt: string | null;
  endsAt: string | null;
  startsAtEpoch: number | null;
  endsAtEpoch: number | null;
} {
  const { startsAt, endsAt, startsAtEpoch, endsAtEpoch } = input;

  const hasIso = Boolean(startsAt || endsAt);
  const hasEpoch = Boolean(startsAtEpoch || endsAtEpoch);

  if (hasIso && hasEpoch) {
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      "Provide either ISO times or epoch seconds, not both."
    );
  }

  if ((startsAt && !endsAt) || (!startsAt && endsAt)) {
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      "Both startsAt and endsAt must be provided together."
    );
  }

  if ((startsAtEpoch && !endsAtEpoch) || (!startsAtEpoch && endsAtEpoch)) {
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      "Both startsAtEpoch and endsAtEpoch must be provided together."
    );
  }

  if (startsAt && endsAt) {
    const s = Date.parse(startsAt);
    const e = Date.parse(endsAt);
    if (!Number.isFinite(s) || !Number.isFinite(e)) {
      throw new ApiError(422, "VALIDATION_ERROR", "Invalid datetime format.");
    }
    if (s >= e) {
      throw new ApiError(422, "VALIDATION_ERROR", "startsAt must be before endsAt.");
    }
    return {
      startsAt: new Date(s).toISOString(),
      endsAt: new Date(e).toISOString(),
      startsAtEpoch: Math.floor(s / 1000),
      endsAtEpoch: Math.floor(e / 1000),
    };
  }

  if (startsAtEpoch && endsAtEpoch) {
    if (startsAtEpoch >= endsAtEpoch) {
      throw new ApiError(422, "VALIDATION_ERROR", "startsAtEpoch must be before endsAtEpoch.");
    }
    return {
      startsAt: new Date(startsAtEpoch * 1000).toISOString(),
      endsAt: new Date(endsAtEpoch * 1000).toISOString(),
      startsAtEpoch,
      endsAtEpoch,
    };
  }

  return { startsAt: null, endsAt: null, startsAtEpoch: null, endsAtEpoch: null };
}

/**
 * Check if two intervals overlap — pure.
 * Intervals are [start, end) — end exclusive.
 */
export function intervalsOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

// ---------------------------------------------------------------------------
// DB check — finds conflicting session in same room
// ---------------------------------------------------------------------------

export type ConflictCheckInput = {
  roomId: string | null | undefined;
  startsAtEpoch: number | null | undefined;
  endsAtEpoch: number | null | undefined;
  excludeSessionId?: string;
};

export async function findScheduleConflict(
  db: Db,
  input: ConflictCheckInput
): Promise<typeof sessions.$inferSelect | null> {
  const { roomId, startsAtEpoch, endsAtEpoch, excludeSessionId } = input;

  if (!roomId || !startsAtEpoch || !endsAtEpoch) return null;

  // Build query: same room, not deleted, not excluded, overlapping epoch
  // Overlap condition: existing.starts_at_epoch < newEnds AND existing.ends_at_epoch > newStarts
  // Only consider sessions that have times set (both epochs not null)

  // Use raw SQL via drizzle where clauses
  // We need to handle null epochs — filter where epochs are not null via where clause

  const whereClauses = [eq(sessions.roomId, roomId), isNull(sessions.deletedAt)];

  if (excludeSessionId) {
    whereClauses.push(ne(sessions.id, excludeSessionId));
  }

  // Fetch all sessions in same room with times, then check overlap in JS
  // This keeps DB query simple and handles null handling portably across D1/better-sqlite3
  const baseQuery = db
    .select()
    .from(sessions)
    .where(and(...whereClauses));

  const rows = (await selectAll(baseQuery)) as Array<typeof sessions.$inferSelect>;

  for (const row of rows) {
    const existingStart = row.startsAtEpoch as number | null;
    const existingEnd = row.endsAtEpoch as number | null;
    if (existingStart == null || existingEnd == null) continue;
    if (intervalsOverlap(existingStart, existingEnd, startsAtEpoch, endsAtEpoch)) {
      return row;
    }
  }

  return null;
}

export async function assertNoScheduleConflict(db: Db, input: ConflictCheckInput): Promise<void> {
  const conflict = await findScheduleConflict(db, input);
  if (conflict) {
    throw new ApiError(
      409,
      "CONFLICT",
      `Schedule conflict: session "${conflict.title}" in same room overlaps (${conflict.startsAt ?? conflict.startsAtEpoch} – ${conflict.endsAt ?? conflict.endsAtEpoch})`
    );
  }
}

/**
 * §22.2 speaker conflict — any other session sharing a speaker with this one, overlapping in time.
 */
export async function findSpeakerConflict(
  db: Db,
  input: {
    sessionId: string;
    startsAtEpoch: number | null | undefined;
    endsAtEpoch: number | null | undefined;
  }
): Promise<typeof sessions.$inferSelect | null> {
  const { sessionId, startsAtEpoch, endsAtEpoch } = input;
  if (!startsAtEpoch || !endsAtEpoch) return null;

  const speakerRows = (await selectAll(
    db
      .select({ speakerId: sessionSpeakers.speakerId })
      .from(sessionSpeakers)
      .where(eq(sessionSpeakers.sessionId, sessionId))
  )) as Array<{ speakerId: string }>;
  const speakerIds = speakerRows.map((r) => r.speakerId);
  if (speakerIds.length === 0) return null;

  const rows = (await selectAll(
    db
      .selectDistinct({
        id: sessions.id,
        title: sessions.title,
        startsAt: sessions.startsAt,
        endsAt: sessions.endsAt,
        startsAtEpoch: sessions.startsAtEpoch,
        endsAtEpoch: sessions.endsAtEpoch,
      })
      .from(sessions)
      .innerJoin(sessionSpeakers, eq(sessions.id, sessionSpeakers.sessionId))
      .where(
        and(
          inArray(sessionSpeakers.speakerId, speakerIds),
          ne(sessions.id, sessionId),
          isNull(sessions.deletedAt)
        )
      )
  )) as Array<typeof sessions.$inferSelect>;

  for (const row of rows) {
    const s = row.startsAtEpoch as number | null;
    const e = row.endsAtEpoch as number | null;
    if (s == null || e == null) continue;
    if (intervalsOverlap(s, e, startsAtEpoch, endsAtEpoch)) return row;
  }
  return null;
}

export async function assertNoSpeakerConflict(
  db: Db,
  input: {
    sessionId: string;
    startsAtEpoch: number | null | undefined;
    endsAtEpoch: number | null | undefined;
  }
): Promise<void> {
  const conflict = await findSpeakerConflict(db, input);
  if (conflict) {
    throw new ApiError(
      409,
      "CONFLICT",
      `Schedule conflict: session "${conflict.title}" shares a speaker and overlaps in time`
    );
  }
}
