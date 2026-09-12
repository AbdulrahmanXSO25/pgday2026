/**
 * Queue abstraction — local in-process vs Cloudflare Queue prod.
 * Pure types, no I/O. Keep DI-friendly for apps/api.
 */

export type QueueMessage<T = unknown> = {
  id: string;
  payload: T;
  attempts: number;
  enqueuedAt: string;
  idempotencyKey?: string;
};

// Options for enqueue — extendable without breaking callers
export type EnqueueOptions = {
  idempotencyKey?: string;
  delayMs?: number;
};

// Core queue contract — DI-friendly, works both locally and on Workers
export type Queue<T = unknown> = {
  enqueue(payload: T, opts?: EnqueueOptions): Promise<string>;
  process(handler: (msg: QueueMessage<T>) => Promise<void>): void;
};

// Email job discriminated union (§25) — registration + CFP mails
export type RegistrationEmailJob = {
  type: "registration_thank_you";
  to: string;
  name: string;
  eventId?: string;
  idempotencyKey?: string;
  requestId?: string;
};

export type RegistrationStatusEmailJob = {
  type: "registration_acceptance" | "registration_rejection" | "registration_waitlist";
  to: string;
  name: string;
  eventId?: string;
  idempotencyKey?: string;
  requestId?: string;
};

export type CfpStatus = "submitted" | "under_review" | "accepted" | "rejected" | "needs_revision";

export type CfpEmailJob = {
  type: "cfp_status";
  to: string;
  name: string;
  title: string;
  status: CfpStatus;
  feedback?: string;
  idempotencyKey?: string;
  requestId?: string;
};

/** Session details attached to the CFP approval email — filled once the talk is scheduled. */
export type CfpSessionDetails = {
  date?: string;
  time?: string;
  room?: string;
  track?: string;
  level?: string;
  duration?: string;
  talkType?: string;
};

export type CfpApprovalEmailJob = {
  type: "cfp_approval";
  to: string;
  name: string;
  title: string;
  session: CfpSessionDetails;
  idempotencyKey?: string;
  requestId?: string;
};

export type EmailJob =
  RegistrationEmailJob | RegistrationStatusEmailJob | CfpEmailJob | CfpApprovalEmailJob;

// Helper to build idempotency key if not provided — pure, deterministic
export function buildEmailIdempotencyKey(job: EmailJob): string {
  if (job.idempotencyKey) return job.idempotencyKey;
  switch (job.type) {
    case "registration_thank_you":
      return `reg:${normalizeEmail(job.to)}:${job.eventId ?? "default"}`;
    case "registration_acceptance":
    case "registration_rejection":
    case "registration_waitlist":
      return `reg-status:${normalizeEmail(job.to)}:${job.eventId ?? "default"}:${job.type}`;
    case "cfp_approval":
      return `cfp-approval:${normalizeEmail(job.to)}:${job.title}`;
    case "cfp_status":
      return `cfp:${normalizeEmail(job.to)}:${job.title}:${job.status}`;
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
