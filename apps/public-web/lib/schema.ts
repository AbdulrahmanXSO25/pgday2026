import { z } from "zod";

export const RegistrationSchema = z.object({
  name: z.string().min(2, { error: "Please enter your full name." }).max(120),
  email: z.email({ error: "Please enter a valid email address." }),
  organization: z
    .string()
    .max(160)
    .optional()
    .transform((v) => (v === undefined || v.trim() === "" ? undefined : v)),
  role: z
    .string()
    .max(160)
    .optional()
    .transform((v) => (v === undefined || v.trim() === "" ? undefined : v)),
  dietaryNotes: z
    .string()
    .max(500, { error: "Keep dietary notes under 500 characters." })
    .optional()
    .transform((v) => (v === undefined || v.trim() === "" ? undefined : v)),
  consent: z.literal(true, {
    error: "You must agree to be contacted about PG Day Egypt 2026.",
  }),
});

export type RegistrationInput = z.input<typeof RegistrationSchema>;
export type RegistrationPayload = z.output<typeof RegistrationSchema>;
