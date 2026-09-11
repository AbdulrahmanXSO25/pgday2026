/**
 * Email queue resolution — production vs local (§25).
 *
 * Production (Workers): the `QUEUE` binding (CF Queue `pgegypt-email`) is
 * present on `c.env` → wrap it with createCfQueueFromEnv so services enqueue
 * through the same Queue<T> interface. The worker's `queue(batch)` handler
 * consumes those messages and sends via Resend.
 *
 * Dev/tests: no binding → returns null, callers fall back to the local
 * in-memory pipeline (Maildev SMTP).
 */

import type { EmailJob } from "@pgegypt/queue";
import { createCfQueueFromEnv } from "@pgegypt/queue";

export type EmailQueue = ReturnType<typeof createCfQueueFromEnv<EmailJob>>;

export function resolveEmailQueue(env: Record<string, unknown> | undefined): EmailQueue | null {
  if (!env || typeof env !== "object") return null;
  const binding = env.QUEUE as { send?: unknown } | undefined;
  if (!binding || typeof binding.send !== "function") return null;
  return createCfQueueFromEnv<EmailJob>(env, "QUEUE");
}
