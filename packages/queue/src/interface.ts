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

export type EmailJob = RegistrationEmailJob | CfpEmailJob;

// Helper to build idempotency key if not provided — pure, deterministic
export function buildEmailIdempotencyKey(job: EmailJob): string {
  if (job.idempotencyKey) return job.idempotencyKey;
  if (job.type === "registration_thank_you") {
    return `reg:${normalizeEmail(job.to)}:${job.eventId ?? "default"}`;
  }
  return `cfp:${normalizeEmail(job.to)}:${job.title}:${job.status}`;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
