import { z } from "zod";

/**
 * Sponsor validation — §13-15
 */

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const tierEnum = z.enum(["platinum", "gold", "silver", "community"]);

export const SponsorBaseSchema = z.object({
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
  tier: tierEnum,
  logoUrl: z
    .string()
    .max(1024)
    .optional()
    .transform((v) =>
      v === undefined || (v as string).trim() === "" ? undefined : (v as string).trim()
    )
    .refine((v) => v === undefined || /^https?:\/\/.+/i.test(v) || v.startsWith("/"), {
      error: "Logo URL must be a valid URL or path.",
    }),
  logoKey: z
    .string()
    .max(512)
    .optional()
    .transform((v) =>
      v === undefined || (v as string).trim() === "" ? undefined : (v as string).trim()
    ),
  url: z
    .string()
    .min(1, { error: "URL is required." })
    .max(1024, { error: "URL must be under 1024 characters." })
    .transform((v) => v.trim())
    .refine((v) => /^https?:\/\/.+/i.test(v), { error: "URL must be a valid http(s) URL." }),
  visible: z
    .union([z.boolean(), z.number().int().min(0).max(1)])
    .optional()
    .transform((v) => (v === undefined ? undefined : v ? 1 : 0)),
  sortOrder: z
    .union([z.number().int().min(0).max(10000), z.string().regex(/^\d+$/)])
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      const n = typeof v === "string" ? Number(v) : v;
      return Number.isFinite(n) ? n : undefined;
    }),
  eventId: z.string().min(1).max(128).optional(),
  event_id: z.string().min(1).max(128).optional(),
});

export const SponsorCreateSchema = SponsorBaseSchema;
export type SponsorCreateInput = z.input<typeof SponsorCreateSchema>;
export type SponsorCreatePayload = z.output<typeof SponsorCreateSchema>;

export const SponsorUpdateSchema = SponsorBaseSchema.partial();
export type SponsorUpdateInput = z.input<typeof SponsorUpdateSchema>;
export type SponsorUpdatePayload = z.output<typeof SponsorUpdateSchema>;

export function normalizeSponsorEventId(payload: {
  eventId?: string;
  event_id?: string;
}): string | undefined {
  const raw = (payload.eventId ?? payload.event_id) as string | undefined;
  if (typeof raw === "string" && raw.trim().length > 0) return raw.trim();
  return undefined;
}
