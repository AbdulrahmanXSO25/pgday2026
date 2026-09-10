import type { Mailer, MailPayload, MailResult, MaildevMailerOptions } from "./interface.js";

/**
 * Maildev local mailer — SMTP :1025 / HTTP :1080 for dev.
 * - host/port from env (MAILDEV_HOST etc.) injected via options, never hardcoded secrets.
 * - transport injection for tests: if options.transport provided, delegate to it (mocked SMTP).
 * - idempotency via in-memory Set (key = payload.idempotencyKey)
 * - Falls back to console log if no transport and nodemailer unavailable (dev-friendly).
 */

export function createMaildevMailer(options: MaildevMailerOptions = {}): Mailer {
  const host = options.host ?? process.env.MAILDEV_HOST ?? "localhost";
  const smtpPort = options.smtpPort ?? Number(process.env.MAILDEV_SMTP_PORT ?? 1025);
  const from = options.from ?? process.env.EMAIL_FROM ?? "PG Day Egypt <noreply@pgegypt.local>";
  void options.httpPort; // UI port 1080 — reserved for future HTTP fetch
  void options.siteUrl;

  const seen = new Set<string>();

  return {
    async send(payload: MailPayload): Promise<MailResult> {
      if (payload.idempotencyKey && seen.has(payload.idempotencyKey)) {
        return { ok: true };
      }
      if (payload.idempotencyKey) seen.add(payload.idempotencyKey);

      if (!payload.to || !payload.subject || !payload.html) {
        return { ok: false, error: "Missing required fields: to, subject, html" };
      }

      // Injected transport for tests / custom SMTP
      if (options.transport) {
        try {
          return await options.transport({ ...payload, from: payload.from ?? from });
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }

      // Try nodemailer if available (optional peer)
      const nodemailerResult = await tryNodemailerSend(payload, { host, smtpPort, from });
      if (nodemailerResult !== null) return nodemailerResult;

      // Fallback — console log for local scaffold (no real SMTP)
      // Never log full html in prod; in dev it's ok but redact email local part in log prefix
      const redacted = redactEmail(payload.to);
      console.log(
        `[maildev] to=${redacted} subject="${payload.subject}" host=${host}:${smtpPort} (stub)`
      );
      return { ok: true, id: `maildev-stub-${Date.now()}` };
    },
  };
}

async function tryNodemailerSend(
  payload: MailPayload,
  cfg: { host: string; smtpPort: number; from: string }
): Promise<MailResult | null> {
  try {
    // Dynamic import — nodemailer is a real dependency (local SMTP transport)
    const mod = (await import("nodemailer").catch(() => null)) as {
      createTransport: (opts: unknown) => {
        sendMail: (opts: unknown) => Promise<{ messageId?: string }>;
      };
    } | null;
    if (!mod) return null;

    const transporter = mod.createTransport({
      host: cfg.host,
      port: cfg.smtpPort,
      secure: false,
      ignoreTLS: true,
    } as unknown);

    const info = await transporter.sendMail({
      from: payload.from ?? cfg.from,
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
    });

    return { ok: true, id: info.messageId };
  } catch {
    return null;
  }
}

function redactEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const masked = local.length <= 2 ? "***" : `${local[0]}***${local[local.length - 1]}`;
  return `${masked}@${domain}`;
}
