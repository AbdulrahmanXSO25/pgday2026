/**
 * @pgegypt/mail — barrel
 * Re-exports Resend (prod) vs Maildev (local) adapters + templates (§25).
 * Idempotency key prevents double send; secrets via env only.
 */

export * from "./interface.js";
export * from "./templates.js";
export * from "./resend-mail.js";
export * from "./maildev-mail.js";

// Convenience: create mailer by env (DI helper)
import type { Mailer } from "./interface.js";
import { createResendMailer } from "./resend-mail.js";
import { createMaildevMailer } from "./maildev-mail.js";

export type MailerEnv = {
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  SITE_URL?: string;
  MAILDEV_HOST?: string;
  NODE_ENV?: string;
  RUNTIME?: string;
};

export function createMailerFromEnv(env: MailerEnv = process.env as MailerEnv): Mailer {
  const from = env.EMAIL_FROM ?? "PG Day Egypt <noreply@pgegypt.org>";
  const siteUrl = env.SITE_URL ?? "https://pgegypt.org";
  const isProd = env.RUNTIME === "production" || env.NODE_ENV === "production";

  if (env.RESEND_API_KEY && isProd) {
    return createResendMailer({ apiKey: env.RESEND_API_KEY, from, siteUrl });
  }
  return createMaildevMailer({ from, siteUrl, host: env.MAILDEV_HOST ?? "localhost" });
}

// Idempotent wrapper — can wrap any Mailer to add dedup without touching adapter
export function createIdempotentMailer(inner: Mailer): Mailer {
  const seen = new Set<string>();
  return {
    async send(payload) {
      if (payload.idempotencyKey) {
        if (seen.has(payload.idempotencyKey)) return { ok: true };
        seen.add(payload.idempotencyKey);
      }
      return inner.send(payload);
    },
  };
}
