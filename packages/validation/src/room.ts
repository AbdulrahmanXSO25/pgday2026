import { z } from "zod";

/**
 * Room validation — §12, §24
 * Rooms schema present but no multi-track UI; FK only.
 */

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const RoomBaseSchema = z.object({
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
  capacity: z
    .union([z.number().int().positive(), z.string().regex(/^\d+$/)])
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      const n = typeof v === "string" ? Number(v) : v;
      if (!Number.isFinite(n) || n <= 0) return undefined;
      return Math.min(n, 10000);
    }),
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

export const RoomCreateSchema = RoomBaseSchema;
export type RoomCreateInput = z.input<typeof RoomCreateSchema>;
export type RoomCreatePayload = z.output<typeof RoomCreateSchema>;

export const RoomUpdateSchema = RoomBaseSchema.partial();
export type RoomUpdateInput = z.input<typeof RoomUpdateSchema>;
export type RoomUpdatePayload = z.output<typeof RoomUpdateSchema>;

export function normalizeRoomEventId(payload: {
  eventId?: string;
  event_id?: string;
}): string | undefined {
  const raw = (payload.eventId ?? payload.event_id) as string | undefined;
  if (typeof raw === "string" && raw.trim().length > 0) return raw.trim();
  return undefined;
}
