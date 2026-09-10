import { z } from "zod";
import siteConfigRaw from "@/content/site-config.json";

export const SocialLinksSchema = z.object({
  twitter: z.string().url().nullable(),
  linkedin: z.string().url().nullable(),
  youtube: z.string().url().nullable(),
});

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
  social: SocialLinksSchema,
  registration: z.object({
    open: z.boolean(),
    closedMessage: z.string(),
  }),
});

export type SiteConfig = z.infer<typeof SiteConfigSchema>;

export const siteConfig: SiteConfig = SiteConfigSchema.parse(siteConfigRaw);
