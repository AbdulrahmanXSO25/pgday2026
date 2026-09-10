import type { QueueMessage, EmailJob } from "@pgegypt/queue";
import type { Mailer } from "@pgegypt/mail";
import { buildThankYouEmail, buildCfpStatusEmail } from "@pgegypt/mail";
import { createLogger, redactEmail } from "../lib/logger.js";

/**
 * Email consumer — handles registration + CFP mails (§25).
 * - Pure handler factory via DI (mailer, siteUrl, logger)
 * - Propagates requestId into structured logs (redacted PII)
 * - Idempotency: caller (queue) dedupes via key; mailer also dedupes
 * - Secrets never logged
 */

export type EmailConsumerDeps = {
  mailer: Mailer;
  siteUrl?: string;
  defaultFrom?: string;
};

export function createEmailConsumer(deps: EmailConsumerDeps) {
  const siteUrl = deps.siteUrl ?? process.env.SITE_URL ?? "https://pgegypt.org";

  return async (msg: QueueMessage<EmailJob>): Promise<void> => {
    const job = msg.payload;
    const requestId = (job as { requestId?: string }).requestId ?? msg.id;
    const log = createLogger(requestId);

    try {
      const result = await handleEmailJob(job, deps.mailer, siteUrl);

      if (result.ok) {
        log.info("email.sent", {
          jobType: job.type,
          to: redactEmail(job.to),
          id: msg.id,
        });
      } else {
        log.error("email.failed", {
          jobType: job.type,
          to: redactEmail(job.to),
          error: result.error,
          id: msg.id,
        });
        // Throw to allow queue retry semantics (attempts tracking)
        throw new Error(result.error);
      }
    } catch (err) {
      const msgText = err instanceof Error ? err.message : String(err);
      log.error("email.consumer.error", {
        jobType: (job as EmailJob).type,
        to: redactEmail((job as EmailJob).to ?? "***"),
        error: msgText,
        attempts: msg.attempts,
      });
      throw err;
    }
  };
}

// Pure handler — testable without queue wrapper
export async function handleEmailJob(
  job: EmailJob,
  mailer: Mailer,
  siteUrl: string
): Promise<{ ok: true; id?: string } | { ok: false; error: string }> {
  if (!job.to || !job.name) {
    return { ok: false, error: "Missing to/name" };
  }

  // Build payload per job type — pure template calls
  if (job.type === "registration_thank_you") {
    const tpl = buildThankYouEmail({ name: job.name, siteUrl });
    return mailer.send({
      to: job.to,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      idempotencyKey:
        job.idempotencyKey ?? `reg:${job.to.toLowerCase()}:${job.eventId ?? "default"}`,
    });
  }

  if (job.type === "cfp_status") {
    const tpl = buildCfpStatusEmail({
      name: job.name,
      title: job.title,
      status: job.status,
      siteUrl,
      feedback: job.feedback,
    });
    return mailer.send({
      to: job.to,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      idempotencyKey:
        job.idempotencyKey ?? `cfp:${job.to.toLowerCase()}:${job.title}:${job.status}`,
    });
  }

  return { ok: false, error: `Unknown job type: ${(job as unknown as { type: string }).type}` };
}

// Helper for Worker queue batch handler — maps CF Queue messages to EmailJob
export async function handleEmailBatch(
  messages: Array<{ body: unknown; id?: string }>,
  deps: EmailConsumerDeps
): Promise<void> {
  const consumer = createEmailConsumer(deps);
  for (const m of messages) {
    const body = m.body as EmailJob;
    if (!body || typeof body !== "object" || !("type" in body)) continue;
    const msg: QueueMessage<EmailJob> = {
      id: m.id ?? crypto.randomUUID(),
      payload: body,
      attempts: 0,
      enqueuedAt: new Date().toISOString(),
    };
    await consumer(msg);
  }
}
