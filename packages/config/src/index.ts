import { z } from "zod";

// Re-exported so apps can validate site-config.json at runtime without importing zod separately.
export const SiteConfigSchema = z.object({
  event: z.object({
    name: z.string(),
    tagline: z.string(),
    date: z.string(),
    dateDisplay: z.string(),
    city: z.string(),
    venueStatus: z.enum(["tba", "confirmed"]),
    venueName: z.string().nullable(),
    venueAddress: z.string().nullable(),
    timezone: z.string(),
  }),
  organizer: z.object({
    name: z.string(),
    contactEmail: z.string().email(),
  }),
  features: z.object({
    showSponsors: z.boolean(),
    showCountdown: z.boolean(),
  }),
  social: z.object({
    twitter: z.string().url().nullable(),
    linkedin: z.string().url().nullable(),
    youtube: z.string().url().nullable(),
  }),
  registration: z.object({
    open: z.boolean(),
    closedMessage: z.string(),
  }),
});

export type SiteConfig = z.infer<typeof SiteConfigSchema>;

/** Pure validator — returns parsed config or throws. */
export function parseSiteConfig(raw: unknown): SiteConfig {
  return SiteConfigSchema.parse(raw);
}

/** API-level env helpers — pure, no I/O. */
export const EnvSchema = z.object({
  DATABASE_URL: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  MAILDEV_HOST: z.string().optional(),
  API_BASE_URL: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function getEnv(): Env {
  // Safe for Node + Workers: read from process.env or globalThis where available
  const source =
    typeof process !== "undefined" && process.env
      ? process.env
      : (globalThis as Record<string, unknown>);
  return EnvSchema.parse(source);
}
