// Re-export canonical registration schema (§18) from dedicated module.
// Kept here for backwards compatibility with existing imports.
export { RegistrationSchema, normalizeRegistrationPayload } from "./registration.js";
export type { RegistrationInput, RegistrationPayload } from "./registration.js";
export {
  CfpSubmissionSchema,
  CfpSpeakerSchema,
  CfpMineQuerySchema,
  normalizeCfpPayload,
  normalizeCfpMineQuery,
} from "./cfp.js";
export type {
  CfpSubmissionInput,
  CfpSubmissionPayload,
  CfpSpeakerInput,
  CfpSpeakerPayload,
  CfpMineQueryInput,
  CfpMineQueryPayload,
  NormalizedCfpPayload,
} from "./cfp.js";

export { SpeakerCreateSchema, SpeakerUpdateSchema, normalizeSpeakerEventId } from "./speaker.js";
export type { SpeakerCreatePayload, SpeakerUpdatePayload } from "./speaker.js";

export { RoomCreateSchema, RoomUpdateSchema, normalizeRoomEventId } from "./room.js";
export type { RoomCreatePayload, RoomUpdatePayload } from "./room.js";

export { SponsorCreateSchema, SponsorUpdateSchema, normalizeSponsorEventId } from "./sponsor.js";
export type { SponsorCreatePayload, SponsorUpdatePayload } from "./sponsor.js";

export {
  SessionCreateSchema,
  SessionUpdateSchema,
  normalizeSessionTimes,
  normalizeSessionEventId,
  normalizeSessionRoomId,
  normalizeSpeakerIds,
} from "./session.js";
export type {
  SessionCreatePayload,
  SessionUpdatePayload,
  NormalizedSessionTimes,
} from "./session.js";
import { z } from "zod";

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
