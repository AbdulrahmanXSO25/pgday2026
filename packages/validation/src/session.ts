import { z } from "zod";

/**
 * Session validation — §24 schedule conflict detection
 * Validates start<end ISO, or unix seconds depending on schema.
 * Room FK only, no multi-track UI.
 */

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isValidIso(value: string): boolean {
  const ts = Date.parse(value);
  return Number.isFinite(ts);
}

const isoString = z
  .string()
  .max(100)
  .transform((v) => v.trim())
  .refine((v) => v === "" || isValidIso(v), { error: "Must be a valid ISO 8601 datetime." })
  .transform((v) => (v === "" ? undefined : v));

const SessionFields = z.object({
  slug: z
    .string()
    .min(1, { error: "Slug is required." })
    .max(80, { error: "Slug must be under 80 characters." })
    .regex(slugRegex, { error: "Slug must be lowercase alphanumeric with hyphens." })
    .transform((v) => v.trim().toLowerCase()),
  title: z
    .string()
    .min(5, { error: "Title must be at least 5 characters." })
    .max(200, { error: "Title must be under 200 characters." })
    .transform((v) => v.trim())
    .refine((v) => v.length >= 5, { error: "Title must be at least 5 characters." }),
  type: z.enum(["talk", "keynote", "panel", "break", "logistics"]).optional().default("talk"),
  level: z.enum(["beginner", "intermediate", "advanced"]).nullable().optional(),
  abstract: z
    .string()
    .max(5000, { error: "Abstract must be under 5000 characters." })
    .optional()
    .transform((v) =>
      v === undefined || (v as string).trim() === "" ? undefined : (v as string).trim()
    ),
  roomId: z
    .string()
    .max(128)
    .optional()
    .nullable()
    .transform((v) => {
      if (v === undefined || v === null) return undefined;
      const s = (v as string).trim();
      return s === "" ? undefined : s;
    }),
  room_id: z
    .string()
    .max(128)
    .optional()
    .nullable()
    .transform((v) => {
      if (v === undefined || v === null) return undefined;
      const s = (v as string).trim();
      return s === "" ? undefined : s;
    }),
  startsAt: isoString.optional(),
  starts_at: isoString.optional(),
  endsAt: isoString.optional(),
  ends_at: isoString.optional(),
  startsAtEpoch: z
    .union([z.number().int().positive(), z.string().regex(/^\d+$/)])
    .optional()
    .nullable()
    .transform((v) => {
      if (v === undefined || v === null) return undefined;
      const n = typeof v === "string" ? Number(v) : v;
      return Number.isFinite(n) && n > 0 ? n : undefined;
    }),
  endsAtEpoch: z
    .union([z.number().int().positive(), z.string().regex(/^\d+$/)])
    .optional()
    .nullable()
    .transform((v) => {
      if (v === undefined || v === null) return undefined;
      const n = typeof v === "string" ? Number(v) : v;
      return Number.isFinite(n) && n > 0 ? n : undefined;
    }),
  isDraft: z
    .union([z.boolean(), z.number().int().min(0).max(1)])
    .optional()
    .transform((v) => (v === undefined ? undefined : v ? 1 : 0)),
  status: z.enum(["draft", "published", "archived"]).optional(),
  speakerIds: z.array(z.string().min(1).max(128)).max(10).optional(),
  speaker_ids: z.array(z.string().min(1).max(128)).max(10).optional(),
  eventId: z.string().min(1).max(128).optional(),
  event_id: z.string().min(1).max(128).optional(),
});

export const SessionBaseSchema = SessionFields.superRefine((data, ctx) => {
  const startsAt = (data.startsAt ?? data.starts_at ?? undefined) as string | undefined;
  const endsAt = (data.endsAt ?? data.ends_at ?? undefined) as string | undefined;
  const startsEpoch = data.startsAtEpoch as number | undefined;
  const endsEpoch = data.endsAtEpoch as number | undefined;

  const hasIso = Boolean(startsAt || endsAt);
  const hasEpoch = Boolean(startsEpoch || endsEpoch);

  if ((startsAt && !endsAt) || (!startsAt && endsAt)) {
    ctx.addIssue({
      code: "custom",
      path: ["endsAt"],
      message: "Both startsAt and endsAt must be provided together.",
    });
    return;
  }
  if ((startsEpoch && !endsEpoch) || (!startsEpoch && endsEpoch)) {
    ctx.addIssue({
      code: "custom",
      path: ["endsAtEpoch"],
      message: "Both startsAtEpoch and endsAtEpoch must be provided together.",
    });
    return;
  }

  if (hasIso && hasEpoch) {
    ctx.addIssue({
      code: "custom",
      path: ["startsAt"],
      message: "Provide either ISO times or epoch seconds, not both.",
    });
    return;
  }

  if (startsAt && endsAt) {
    const s = Date.parse(startsAt);
    const e = Date.parse(endsAt);
    if (!Number.isFinite(s) || !Number.isFinite(e)) {
      ctx.addIssue({ code: "custom", path: ["startsAt"], message: "Invalid datetime format." });
      return;
    }
    if (s >= e) {
      ctx.addIssue({
        code: "custom",
        path: ["startsAt"],
        message: "startsAt must be before endsAt.",
      });
    }
  }

  if (startsEpoch && endsEpoch) {
    if (startsEpoch >= endsEpoch) {
      ctx.addIssue({
        code: "custom",
        path: ["startsAtEpoch"],
        message: "startsAtEpoch must be before endsAtEpoch.",
      });
    }
  }
});

export const SessionCreateSchema = SessionBaseSchema;
export type SessionCreateInput = z.input<typeof SessionCreateSchema>;
export type SessionCreatePayload = z.output<typeof SessionCreateSchema>;

export const SessionUpdateSchema = SessionFields.partial().superRefine((data, ctx) => {
  const startsAt = (data.startsAt ?? data.starts_at ?? undefined) as string | undefined;
  const endsAt = (data.endsAt ?? data.ends_at ?? undefined) as string | undefined;
  const startsEpoch = data.startsAtEpoch as number | undefined;
  const endsEpoch = data.endsAtEpoch as number | undefined;

  // Partial update: if one ISO provided, both must be provided
  if ((startsAt && !endsAt) || (!startsAt && endsAt)) {
    ctx.addIssue({
      code: "custom",
      path: ["endsAt"],
      message: "Both startsAt and endsAt must be provided together.",
    });
  }
  if ((startsEpoch && !endsEpoch) || (!startsEpoch && endsEpoch)) {
    ctx.addIssue({
      code: "custom",
      path: ["endsAtEpoch"],
      message: "Both startsAtEpoch and endsAtEpoch must be provided together.",
    });
  }
  if (startsAt && endsAt) {
    const s = Date.parse(startsAt);
    const e = Date.parse(endsAt);
    if (Number.isFinite(s) && Number.isFinite(e) && s >= e) {
      ctx.addIssue({
        code: "custom",
        path: ["startsAt"],
        message: "startsAt must be before endsAt.",
      });
    }
  }
  if (startsEpoch && endsEpoch && startsEpoch >= endsEpoch) {
    ctx.addIssue({
      code: "custom",
      path: ["startsAtEpoch"],
      message: "startsAtEpoch must be before endsAtEpoch.",
    });
  }
  if (startsAt && startsEpoch) {
    ctx.addIssue({
      code: "custom",
      path: ["startsAt"],
      message: "Provide either ISO times or epoch seconds, not both.",
    });
  }
});

export type SessionUpdateInput = z.input<typeof SessionUpdateSchema>;
export type SessionUpdatePayload = z.output<typeof SessionUpdateSchema>;

export type NormalizedSessionTimes = {
  startsAt: string | null;
  endsAt: string | null;
  startsAtEpoch: number | null;
  endsAtEpoch: number | null;
};

export function normalizeSessionTimes(payload: {
  startsAt?: string;
  starts_at?: string;
  endsAt?: string;
  ends_at?: string;
  startsAtEpoch?: number;
  endsAtEpoch?: number;
}): NormalizedSessionTimes {
  const startsRaw = (payload.startsAt ?? payload.starts_at ?? undefined) as string | undefined;
  const endsRaw = (payload.endsAt ?? payload.ends_at ?? undefined) as string | undefined;
  let startsEpoch = payload.startsAtEpoch as number | undefined;
  let endsEpoch = payload.endsAtEpoch as number | undefined;

  let startsAt: string | null = null;
  let endsAt: string | null = null;

  if (startsRaw && endsRaw) {
    startsAt = new Date(Date.parse(startsRaw)).toISOString();
    endsAt = new Date(Date.parse(endsRaw)).toISOString();
    startsEpoch = Math.floor(Date.parse(startsRaw) / 1000);
    endsEpoch = Math.floor(Date.parse(endsRaw) / 1000);
  } else if (startsEpoch && endsEpoch) {
    startsAt = new Date(startsEpoch * 1000).toISOString();
    endsAt = new Date(endsEpoch * 1000).toISOString();
  }

  return {
    startsAt,
    endsAt,
    startsAtEpoch: startsEpoch ?? null,
    endsAtEpoch: endsEpoch ?? null,
  };
}

export function normalizeSessionEventId(payload: {
  eventId?: string;
  event_id?: string;
}): string | undefined {
  const raw = (payload.eventId ?? payload.event_id) as string | undefined;
  if (typeof raw === "string" && raw.trim().length > 0) return raw.trim();
  return undefined;
}

export function normalizeSessionRoomId(payload: {
  roomId?: string;
  room_id?: string;
}): string | undefined {
  const raw = (payload.roomId ?? payload.room_id) as string | undefined;
  if (typeof raw === "string" && raw.trim().length > 0) return raw.trim();
  return undefined;
}

export function normalizeSpeakerIds(payload: {
  speakerIds?: string[];
  speaker_ids?: string[];
}): string[] | undefined {
  const raw = payload.speakerIds ?? payload.speaker_ids;
  if (!raw) return undefined;
  return raw.map((s) => s.trim()).filter((s) => s.length > 0);
}
