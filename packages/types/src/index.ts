import type { z } from "zod";
import type {
  RegistrationSchema,
  SpeakerSchema,
  ScheduleItemSchema,
  SponsorSchema,
} from "@pgegypt/validation";

export type Speaker = z.infer<typeof SpeakerSchema>;
export type ScheduleItem = z.infer<typeof ScheduleItemSchema>;
export type Sponsor = z.infer<typeof SponsorSchema>;
export type RegistrationPayload = z.infer<typeof RegistrationSchema>;

export type SponsorTier = Sponsor["tier"];

export const sponsorTierOrder = ["platinum", "gold", "silver", "community"] as const;

export type ApiSuccess<T> = { success: true; data: T };
export type ApiError = { success: false; message: string; fieldErrors?: Record<string, string> };
export type ApiResult<T> = ApiSuccess<T> | ApiError;

export type PaginationParams = { page: number; pageSize: number };
export type Paginated<T> = { items: T[]; total: number; page: number; pageSize: number };
