import type { Mailer, MailPayload, MailResult, ResendMailerOptions } from "./interface.js";

/**
 * Resend prod mailer — uses Resend HTTP API via fetch.
 * Secrets via injected apiKey (caller reads env), never logged.
 * Idempotency: in-memory Set deduplicates by payload.idempotencyKey.
 */

export function createResendMailer(options: ResendMailerOptions): Mailer {
  const { apiKey, from, siteUrl: _siteUrl, fetchImpl } = options;
  void _siteUrl;
  if (!apiKey) throw new Error("Resend apiKey is required — set RESEND_API_KEY env");
  if (!from) throw new Error("Resend from address is required");

  const doFetch: typeof fetch = fetchImpl ?? globalThis.fetch.bind(globalThis);
  const seen = new Set<string>();

  return {
    async send(payload: MailPayload): Promise<MailResult> {
      // Idempotency gate — return success without re-sending
      if (payload.idempotencyKey) {
        if (seen.has(payload.idempotencyKey)) {
          return { ok: true };
        }
        seen.add(payload.idempotencyKey);
      }

      if (!payload.to || !payload.subject || !payload.html) {
        return { ok: false, error: "Missing required fields: to, subject, html" };
      }

      // Validate email shape — don't log raw email on failure beyond redacted
      if (!isValidEmail(payload.to)) {
        return { ok: false, error: "Invalid recipient email" };
      }

      try {
        const headers: Record<string, string> = {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        };
        if (payload.idempotencyKey) {
          headers["Idempotency-Key"] = payload.idempotencyKey;
        }
        // Merge custom headers (skip overriding auth)
        if (payload.headers) {
          for (const [k, v] of Object.entries(payload.headers)) {
            if (k.toLowerCase() === "authorization") continue;
            headers[k] = v;
          }
        }

        const body = JSON.stringify({
          from: payload.from ?? from,
          to: payload.to,
          subject: payload.subject,
          html: payload.html,
          text: payload.text,
          cc: payload.cc,
          bcc: payload.bcc,
        });

        const res = await doFetch("https://api.resend.com/emails", {
          method: "POST",
          headers,
          body,
        });

        if (!res.ok) {
          const errText = await safeReadText(res);
          // Never include apiKey in error; redact PII
          return { ok: false, error: `Resend ${res.status}: ${truncate(errText, 500)}` };
        }

        const data = (await safeReadJson(res)) as { id?: string } | null;
        return { ok: true, id: data?.id };
      } catch (err) {
        // Do not leak apiKey or raw payload
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: truncate(msg, 500) };
      }
    },
  };
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

async function safeReadJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}
