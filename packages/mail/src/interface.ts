/**
 * Mail adapter interface — Resend prod vs Maildev local.
 * Secrets via env only, never hardcoded. Idempotency via key dedup.
 */

export type MailPayload = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  cc?: string[];
  bcc?: string[];
  idempotencyKey?: string;
  // Optional headers bag
  headers?: Record<string, string>;
};

export type MailResult = { ok: true; id?: string } | { ok: false; error: string };

export type Mailer = {
  send(payload: MailPayload): Promise<MailResult>;
};

// Config types — all injected via DI, no direct process.env read inside adapters
export type MailConfig = {
  from: string;
  siteUrl: string;
};

// Factory option shapes
export type ResendMailerOptions = {
  apiKey: string;
  from: string;
  siteUrl?: string;
  fetchImpl?: typeof fetch;
};

export type MaildevMailerOptions = {
  host?: string;
  smtpPort?: number;
  httpPort?: number;
  from?: string;
  siteUrl?: string;
  // Injected transport for tests — if provided, used instead of SMTP
  transport?: (payload: MailPayload) => Promise<MailResult>;
};
