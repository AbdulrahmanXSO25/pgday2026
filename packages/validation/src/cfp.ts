import { z } from "zod";

/**
 * CFP validation — §19, §34
 * Public anonymous submit: POST /v1/cfp/submissions
 * - Zod at boundary, explicit error envelope via validateJson (422)
 * - Email normalization (trim + lowercase) happens in service, but schema trims
 * - Supports aliases: track/sessionType, notes/submitterBio, speakers/coSpeakers
 *   to tolerate spec variations (§19) while keeping canonical output stable.
 * - Pure, no side effects.
 */

// ---------------------------------------------------------------------------
// Speaker (co-speaker) — used in speakers[] / coSpeakers[]
// ---------------------------------------------------------------------------
export const CfpSpeakerSchema = z
  .object({
    name: z
      .string()
      .min(2, { error: "Speaker name must be at least 2 characters." })
      .max(120, { error: "Speaker name must be under 120 characters." })
      .optional()
      .transform((v) => (v === undefined || v.trim() === "" ? undefined : v.trim())),
    // §19.1 alias — spec uses fullName
    fullName: z
      .string()
      .min(2)
      .max(120)
      .optional()
      .transform((v) => (v === undefined || v.trim() === "" ? undefined : v.trim())),
    email: z
      .email({ error: "Please enter a valid speaker email address." })
      .max(254, { error: "Email must be under 254 characters." })
      .transform((v) => (v as string).trim()),
    bio: z
      .string()
      .max(2000, { error: "Bio must be under 2000 characters." })
      .optional()
      .transform((v) =>
        v === undefined || (v as string).trim() === "" ? undefined : (v as string).trim()
      ),
    company: z
      .string()
      .max(160)
      .optional()
      .transform((v) =>
        v === undefined || (v as string).trim() === "" ? undefined : (v as string).trim()
      ),
    role: z
      .string()
      .max(160)
      .optional()
      .transform((v) =>
        v === undefined || (v as string).trim() === "" ? undefined : (v as string).trim()
      ),
    // §19.1 — portrait uploaded via media presign (URL + storage key)
    photoUrl: z
      .string()
      .url({ error: "Photo URL must be a valid URL." })
      .max(500)
      .optional()
      .nullable()
      .transform((v) => (v === undefined || v === null || v.trim() === "" ? undefined : v.trim())),
    photoKey: z
      .string()
      .max(300)
      .optional()
      .nullable()
      .transform((v) => (v === undefined || v === null || v.trim() === "" ? undefined : v.trim())),
    // §19.1 — primary marker (bool or 0/1)
    isPrimary: z
      .union([z.boolean(), z.number().int().min(0).max(1)])
      .optional()
      .transform((v) => (v === undefined ? undefined : v ? 1 : 0)),
  })
  .transform((v) => ({ ...v, name: (v.name ?? v.fullName ?? "").trim() }))
  .superRefine((data, ctx) => {
    if (!data.name || data.name.length < 2) {
      ctx.addIssue({
        code: "custom",
        path: ["name"],
        message: "Speaker name is required (name or fullName).",
      });
    }
  });

export type CfpSpeakerInput = z.input<typeof CfpSpeakerSchema>;
export type CfpSpeakerPayload = z.output<typeof CfpSpeakerSchema>;

// ---------------------------------------------------------------------------
// Submission — canonical POST body
// Accepts aliases so callers can use either naming:
//   track <-> sessionType <-> track
//   submitterBio <-> notes <-> bio
//   speakers <-> coSpeakers
// ---------------------------------------------------------------------------

const levelEnum = z.enum(["beginner", "intermediate", "advanced"]);

export const CfpSubmissionSchema = z
  .object({
    title: z
      .string()
      .min(5, { error: "Title must be at least 5 characters." })
      .max(200, { error: "Title must be under 200 characters." })
      .transform((v) => v.trim())
      .refine((v) => v.length >= 5, { error: "Title must be at least 5 characters." }),

    abstract: z
      .string()
      .min(20, { error: "Abstract must be at least 20 characters." })
      .max(5000, { error: "Abstract must be under 5000 characters." })
      .transform((v) => v.trim())
      .refine((v) => v.length >= 20, { error: "Abstract must be at least 20 characters." }),

    // Track aliases — at least one optional
    track: z
      .string()
      .max(80, { error: "Track must be under 80 characters." })
      .optional()
      .transform((v) =>
        v === undefined || (v as string).trim() === "" ? undefined : (v as string).trim()
      ),
    sessionType: z
      .string()
      .max(80)
      .optional()
      .transform((v) =>
        v === undefined || (v as string).trim() === "" ? undefined : (v as string).trim()
      ),

    level: levelEnum.optional(),

    // Submitter — required for ownership / mine listing
    submitterName: z
      .string()
      .min(2, { error: "Please enter your full name." })
      .max(120, { error: "Name must be under 120 characters." })
      .optional()
      .transform((v) =>
        v === undefined || (v as string).trim() === "" ? undefined : (v as string).trim()
      ),
    submitterEmail: z
      .email({ error: "Please enter a valid email address." })
      .max(254)
      .optional()
      .transform((v) => (v === undefined ? undefined : (v as string).trim())),

    // Legacy single-field aliases for submitter (some clients may send speakerEmail/name)
    name: z
      .string()
      .min(2)
      .max(120)
      .optional()
      .transform((v) =>
        v === undefined || (v as string).trim() === "" ? undefined : (v as string).trim()
      ),
    email: z
      .email()
      .optional()
      .transform((v) => (v === undefined ? undefined : (v as string).trim())),

    // Bio / notes aliases
    submitterBio: z
      .string()
      .max(2000, { error: "Bio must be under 2000 characters." })
      .optional()
      .transform((v) =>
        v === undefined || (v as string).trim() === "" ? undefined : (v as string).trim()
      ),
    // Portrait uploaded via public CFP presign (media presign → direct PUT)
    submitterPhotoUrl: z
      .string()
      .url({ error: "Photo URL must be a valid URL." })
      .max(500)
      .optional()
      .nullable()
      .transform((v) => (v === undefined || v === null || v.trim() === "" ? undefined : v.trim())),
    submitterPhotoKey: z
      .string()
      .max(300)
      .optional()
      .nullable()
      .transform((v) => (v === undefined || v === null || v.trim() === "" ? undefined : v.trim())),
    bio: z
      .string()
      .max(2000)
      .optional()
      .transform((v) =>
        v === undefined || (v as string).trim() === "" ? undefined : (v as string).trim()
      ),
    notes: z
      .string()
      .max(5000)
      .optional()
      .transform((v) =>
        v === undefined || (v as string).trim() === "" ? undefined : (v as string).trim()
      ),
    // §19.1 alias — notesToOrganizers
    notesToOrganizers: z
      .string()
      .max(5000)
      .optional()
      .transform((v) =>
        v === undefined || (v as string).trim() === "" ? undefined : (v as string).trim()
      ),

    // Co-speakers aliases
    coSpeakers: z
      .array(CfpSpeakerSchema)
      .max(4, { error: "Too many co-speakers (max 4)." })
      .optional(),
    speakers: z.array(CfpSpeakerSchema).max(5, { error: "Too many speakers (max 5)." }).optional(),

    // Optional event scoping (defaults to primary event in service)
    eventId: z.string().min(1).max(128).optional(),
    event_id: z.string().min(1).max(128).optional(),
    // §30.4 honeypot — must stay empty; bots that fill it fail validation with 422
    website: z
      .string()
      .max(0, { error: "Invalid submission." })
      .optional()
      .transform((v) => (v === undefined || v.trim() === "" ? undefined : v)),
  })
  .superRefine((data, ctx) => {
    // §19.1: submitter identity may come from the primary speaker when no top-level submitter fields sent
    const speakerList = (data.speakers ?? data.coSpeakers ?? []) as Array<{
      name: string;
      email: string;
      isPrimary?: number;
    }>;
    const primary = speakerList.find((s) => s.isPrimary === 1) ?? speakerList[0];
    const email = data.submitterEmail ?? data.email ?? primary?.email;
    if (!email || email.trim().length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["submitterEmail"],
        message: "Submitter email is required.",
      });
    }
    const name = data.submitterName ?? data.name ?? primary?.name;
    if (!name || name.trim().length < 2) {
      ctx.addIssue({
        code: "custom",
        path: ["submitterName"],
        message: "Submitter name is required.",
      });
    }
  });

export type CfpSubmissionInput = z.input<typeof CfpSubmissionSchema>;
export type CfpSubmissionPayload = z.output<typeof CfpSubmissionSchema>;

// ---------------------------------------------------------------------------
// Normalize — resolve aliases into canonical shape for service
// Pure function, no DB.
// ---------------------------------------------------------------------------
export type NormalizedCfpPayload = {
  title: string;
  abstract: string;
  track?: string;
  level?: "beginner" | "intermediate" | "advanced";
  submitterName: string;
  submitterEmail: string;
  submitterBio?: string;
  submitterPhotoUrl?: string;
  submitterPhotoKey?: string;
  eventId?: string;
  coSpeakers: CfpSpeakerPayload[];
};

export function normalizeCfpPayload(payload: CfpSubmissionPayload): NormalizedCfpPayload {
  const track = (payload.track ?? payload.sessionType ?? undefined) as string | undefined;
  const speakerList = (payload.speakers ?? payload.coSpeakers ?? []) as CfpSpeakerPayload[];
  const primary =
    speakerList.find((s) => (s as { isPrimary?: number }).isPrimary === 1) ?? speakerList[0];
  const submitterName = (
    (payload.submitterName ?? payload.name ?? primary?.name ?? "") as string
  ).trim();
  const rawEmail = (
    (payload.submitterEmail ?? payload.email ?? primary?.email ?? "") as string
  ).trim();
  const submitterEmail = rawEmail.toLowerCase();
  const submitterBio = (payload.submitterBio ??
    payload.bio ??
    payload.notes ??
    payload.notesToOrganizers ??
    undefined) as string | undefined;
  const submitterPhotoUrl = (payload.submitterPhotoUrl ?? primary?.photoUrl ?? undefined) as
    string | undefined;
  const submitterPhotoKey = (payload.submitterPhotoKey ?? primary?.photoKey ?? undefined) as
    string | undefined;
  const eventId = (payload.eventId ?? payload.event_id ?? undefined) as string | undefined;

  // Merge speakers / coSpeakers — if speakers includes primary, treat tail as coSpeakers
  // If both present, concat coSpeakers first then speakers tail (dedup later by service if needed)
  // Pure: do not mutate inputs, create new array
  const rawSpeakers = payload.speakers ?? [];
  const rawCoSpeakers = payload.coSpeakers ?? [];

  // If speakers array contains the submitter as first entry, skip it to avoid duplication
  // Heuristic: if speakers[0] email matches submitterEmail, drop it (primary already represented)
  let extra: CfpSpeakerPayload[] = [];
  if (rawSpeakers.length > 0) {
    const firstMatchesSubmitter = rawSpeakers[0]?.email.trim().toLowerCase() === submitterEmail;
    const base = firstMatchesSubmitter ? rawSpeakers.slice(1) : rawSpeakers;
    extra = [...base, ...rawCoSpeakers];
  } else {
    extra = [...rawCoSpeakers];
  }

  // Normalize co-speaker emails to lowercase + trim
  const coSpeakers: CfpSpeakerPayload[] = extra.map((s) => ({
    ...s,
    name: s.name.trim(),
    email: s.email.trim().toLowerCase(),
    bio: s.bio,
    company: s.company,
    role: s.role,
    photoUrl: s.photoUrl,
    photoKey: s.photoKey,
  }));

  return {
    title: payload.title.trim(),
    abstract: payload.abstract.trim(),
    track: track?.trim() || undefined,
    level: payload.level,
    submitterName: submitterName.trim(),
    submitterEmail,
    submitterBio: submitterBio?.trim() || undefined,
    submitterPhotoUrl: submitterPhotoUrl?.trim() || undefined,
    submitterPhotoKey: submitterPhotoKey?.trim() || undefined,
    eventId: eventId?.trim() || undefined,
    coSpeakers,
  };
}

// ---------------------------------------------------------------------------
// Mine query — GET /v1/cfp/submissions/mine?email=...
// ---------------------------------------------------------------------------
export const CfpMineQuerySchema = z.object({
  email: z
    .email({ error: "Valid email query param is required." })
    .transform((v) => (v as string).trim().toLowerCase()),
  eventId: z.string().min(1).max(128).optional(),
  event_id: z.string().min(1).max(128).optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === "" ? undefined : v.trim())),
  offset: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === "" ? undefined : v.trim())),
});

export type CfpMineQueryInput = z.input<typeof CfpMineQuerySchema>;
export type CfpMineQueryPayload = z.output<typeof CfpMineQuerySchema>;

export function normalizeCfpMineQuery(payload: CfpMineQueryPayload): {
  email: string;
  eventId?: string;
  limit?: number;
  offset?: number;
} {
  const eventId = (payload.eventId ?? payload.event_id ?? undefined) as string | undefined;
  const limit = payload.limit ? Number(payload.limit) : undefined;
  const offset = payload.offset ? Number(payload.offset) : undefined;
  return {
    email: payload.email.trim().toLowerCase(),
    eventId: eventId?.trim() || undefined,
    limit: Number.isFinite(limit as number) ? (limit as number) : undefined,
    offset: Number.isFinite(offset as number) ? (offset as number) : undefined,
  };
}
