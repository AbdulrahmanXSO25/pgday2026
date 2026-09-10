import { z } from "zod";
import speakersRaw from "@/content/speakers.json";
import scheduleRaw from "@/content/schedule.json";
import sponsorsRaw from "@/content/sponsors.json";
import organizersRaw from "@/content/organizers.json";
import faqRaw from "@/content/faq.json";

export const SpeakerSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  company: z.string(),
  bio: z.string(),
  photo: z.string(),
  social: z.object({
    linkedin: z.string().url().nullable(),
    twitter: z.string().url().nullable(),
  }),
  talkId: z.string(),
});

export const ScheduleItemSchema = z.object({
  id: z.string(),
  start: z.string(),
  end: z.string(),
  title: z.string(),
  type: z.enum(["talk", "keynote", "panel", "break", "logistics"]),
  level: z.enum(["beginner", "intermediate", "advanced"]).nullable().optional(),
  abstract: z.string().optional(),
  speakerIds: z.array(z.string()),
});

export const SponsorSchema = z.object({
  id: z.string(),
  name: z.string(),
  tier: z.enum(["platinum", "gold", "silver", "community"]),
  logo: z.string(),
  url: z.string().url(),
  visible: z.boolean(),
});

export const OrganizerSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  bio: z.string(),
  social: z.object({
    linkedin: z.string().url().nullable(),
    twitter: z.string().url().nullable(),
  }),
});

export const FaqItemSchema = z.object({
  id: z.string(),
  question: z.string(),
  answer: z.string(),
});

export type Speaker = z.infer<typeof SpeakerSchema>;
export type ScheduleItem = z.infer<typeof ScheduleItemSchema>;
export type Sponsor = z.infer<typeof SponsorSchema>;
export type Organizer = z.infer<typeof OrganizerSchema>;
export type FaqItem = z.infer<typeof FaqItemSchema>;

export const speakers: Speaker[] = SpeakerSchema.array().parse(speakersRaw);
export const schedule: ScheduleItem[] = ScheduleItemSchema.array().parse(scheduleRaw);
export const sponsors: Sponsor[] = SponsorSchema.array().parse(sponsorsRaw);
export const organizers: Organizer[] = OrganizerSchema.array().parse(organizersRaw);
export const faqItems: FaqItem[] = FaqItemSchema.array().parse(faqRaw);

const speakerById = new Map(speakers.map((s) => [s.id, s]));
const sessionById = new Map(schedule.map((s) => [s.id, s]));

export function getSpeaker(id: string): Speaker | undefined {
  return speakerById.get(id);
}

export function getSession(id: string): ScheduleItem | undefined {
  return sessionById.get(id);
}

export function getSpeakerSessions(speakerId: string): ScheduleItem[] {
  return schedule.filter((s) => s.speakerIds.includes(speakerId));
}

export function getVisibleSponsors(): Sponsor[] {
  return sponsors.filter((s) => s.visible);
}

export const sponsorTierOrder = ["platinum", "gold", "silver", "community"] as const;
export type SponsorTier = (typeof sponsorTierOrder)[number];

export const sponsorTierLabels: Record<SponsorTier, string> = {
  platinum: "Platinum",
  gold: "Gold",
  silver: "Silver",
  community: "Community Supporter",
};

export const sessionTypeLabels: Record<ScheduleItem["type"], string> = {
  talk: "Talk",
  keynote: "Keynote",
  panel: "Panel",
  break: "Break",
  logistics: "—",
};
