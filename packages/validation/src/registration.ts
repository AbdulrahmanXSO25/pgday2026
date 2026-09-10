import { z } from "zod";

/**
 * RegistrationSchema — §18
 * Validated at POST /v1/registrations boundary.
 * - email normalized lowercase in service (not here, preserve original for zod email check)
 * - eventId optional; when absent defaults to primary event in service layer.
 * - consent must be true.
 */
export const RegistrationSchema = z.object({
  name: z
    .string()
    .min(2, { error: "Please enter your full name." })
    .max(120, { error: "Name must be under 120 characters." })
    .transform((v) => v.trim())
    .refine((v) => v.length >= 2, { error: "Please enter your full name." }),
  email: z
    .email({ error: "Please enter a valid email address." })
    .max(254, { error: "Email must be under 254 characters." })
    .transform((v) => (v as string).trim()),
  organization: z
    .string()
    .max(160, { error: "Organization must be under 160 characters." })
    .optional()
    .transform((v) =>
      v === undefined || (v as string).trim() === "" ? undefined : (v as string).trim()
    ),
  role: z
    .string()
    .max(160, { error: "Role must be under 160 characters." })
    .optional()
    .transform((v) =>
      v === undefined || (v as string).trim() === "" ? undefined : (v as string).trim()
    ),
  dietaryNotes: z
    .string()
    .max(500, { error: "Keep dietary notes under 500 characters." })
    .optional()
    .transform((v) =>
      v === undefined || (v as string).trim() === "" ? undefined : (v as string).trim()
    ),
  consent: z.literal(true, {
    error: "You must agree to be contacted about PG Day Egypt 2026.",
  }),
  // eventId is optional — when omitted service uses the default event.
  // Accepts both `eventId` and `event_id` via preprocessing in service/route.
  eventId: z.string().min(1).max(128).optional(),
  event_id: z.string().min(1).max(128).optional(),
  // §30.4 honeypot — must stay empty; bots that fill it fail validation with 422.
  website: z
    .string()
    .max(0, { error: "Invalid submission." })
    .optional()
    .transform((v) => (v === undefined || v.trim() === "" ? undefined : v)),
});

export type RegistrationInput = z.input<typeof RegistrationSchema>;
export type RegistrationPayload = z.output<typeof RegistrationSchema>;

/**
 * Normalizes payload after Zod parsing:
 * - lowercases email
 * - resolves eventId from either `eventId` or `event_id`
 */
export function normalizeRegistrationPayload(payload: RegistrationPayload): {
  name: string;
  email: string;
  organization?: string;
  role?: string;
  dietaryNotes?: string;
  eventId?: string;
} {
  const rawEventId = payload.eventId ?? payload.event_id ?? undefined;
  return {
    name: payload.name.trim(),
    email: payload.email.trim().toLowerCase(),
    organization: payload.organization,
    role: payload.role,
    dietaryNotes: payload.dietaryNotes,
    eventId: rawEventId,
  };
}
