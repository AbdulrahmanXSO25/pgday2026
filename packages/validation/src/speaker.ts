import { z } from "zod";

/**
 * Speaker validation — §13-15
 * Admin CRUD via /v1/admin/speakers with Zod RBAC.
 * Pure schemas, no side effects.
 */

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const SpeakerBaseSchema = z.object({
  slug: z
    .string()
    .min(1, { error: "Slug is required." })
    .max(80, { error: "Slug must be under 80 characters." })
    .regex(slugRegex, { error: "Slug must be lowercase alphanumeric with hyphens." })
    .transform((v) => v.trim().toLowerCase()),
  name: z
    .string()
    .min(2, { error: "Name must be at least 2 characters." })
    .max(120, { error: "Name must be under 120 characters." })
    .transform((v) => v.trim())
    .refine((v) => v.length >= 2, { error: "Name must be at least 2 characters." }),
  role: z
    .string()
    .max(160, { error: "Role must be under 160 characters." })
    .optional()
    .transform((v) =>
      v === undefined || (v as string).trim() === "" ? undefined : (v as string).trim()
    ),
  company: z
    .string()
    .max(160, { error: "Company must be under 160 characters." })
    .optional()
    .transform((v) =>
      v === undefined || (v as string).trim() === "" ? undefined : (v as string).trim()
    ),
  bio: z
    .string()
    .min(20, { error: "Bio must be at least 20 characters." })
    .max(5000, { error: "Bio must be under 5000 characters." })
    .transform((v) => v.trim())
    .refine((v) => v.length >= 20, { error: "Bio must be at least 20 characters." }),
  photoUrl: z
    .string()
    .max(1024)
    .optional()
    .transform((v) =>
      v === undefined || (v as string).trim() === "" ? undefined : (v as string).trim()
    )
    .refine((v) => v === undefined || v === "" || /^https?:\/\/.+/i.test(v) || v.startsWith("/"), {
      error: "Photo URL must be a valid URL or path.",
    }),
  photoKey: z
    .string()
    .max(512)
    .optional()
    .transform((v) =>
      v === undefined || (v as string).trim() === "" ? undefined : (v as string).trim()
    ),
  linkedin: z
    .string()
    .max(512)
    .optional()
    .transform((v) =>
      v === undefined || (v as string).trim() === "" ? undefined : (v as string).trim()
    )
    .refine((v) => v === undefined || /^https?:\/\/.+/i.test(v), {
      error: "LinkedIn must be a valid URL.",
    }),
  twitter: z
    .string()
    .max(512)
    .optional()
    .transform((v) =>
      v === undefined || (v as string).trim() === "" ? undefined : (v as string).trim()
    )
    .refine((v) => v === undefined || /^https?:\/\/.+/i.test(v) || /^@?[A-Za-z0-9_]+$/.test(v), {
      error: "Twitter must be a valid URL or handle.",
    }),
  isDraft: z
    .union([z.boolean(), z.number().int().min(0).max(1)])
    .optional()
    .transform((v) => (v === undefined ? undefined : v ? 1 : 0)),
  // §12.5 alias — status draft|published maps to isDraft (1|0) for spec-shaped clients
  status: z
    .enum(["draft", "published"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "draft" ? 1 : 0)),
  eventId: z.string().min(1).max(128).optional(),
  event_id: z.string().min(1).max(128).optional(),
});

export const SpeakerCreateSchema = SpeakerBaseSchema;
export type SpeakerCreateInput = z.input<typeof SpeakerCreateSchema>;
export type SpeakerCreatePayload = z.output<typeof SpeakerCreateSchema>;

export const SpeakerUpdateSchema = SpeakerBaseSchema.partial();
export type SpeakerUpdateInput = z.input<typeof SpeakerUpdateSchema>;
export type SpeakerUpdatePayload = z.output<typeof SpeakerUpdateSchema>;

export function normalizeSpeakerEventId(payload: {
  eventId?: string;
  event_id?: string;
}): string | undefined {
  const raw = (payload.eventId ?? payload.event_id) as string | undefined;
  if (typeof raw === "string" && raw.trim().length > 0) return raw.trim();
  return undefined;
}
