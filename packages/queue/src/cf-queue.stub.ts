import type { EnqueueOptions, Queue, QueueMessage } from "./interface.js";

/**
 * Cloudflare Queue stub — prod shape without live binding.
 * Keeps same Queue<T> interface so app code is runtime-agnostic.
 * In real Workers, `binding.send` would enqueue to CF Queue.
 * This stub logs in non-prod and is no-op for process (Workers use `queue(batch)` handler).
 */

export type CfQueueBinding = {
  send(message: unknown): Promise<void>;
  sendBatch?(messages: Array<{ body: unknown }>): Promise<void>;
};

export type CfQueueOptions = {
  queueName?: string;
};

export function createCfQueue<T>(
  binding: CfQueueBinding | undefined,
  opts: CfQueueOptions = {}
): Queue<T> {
  const queueName = opts.queueName ?? "email-queue";
  const seenKeys = new Set<string>();

  return {
    async enqueue(payload: T, enqueueOpts?: EnqueueOptions): Promise<string> {
      if (enqueueOpts?.idempotencyKey && seenKeys.has(enqueueOpts.idempotencyKey)) {
        return enqueueOpts.idempotencyKey;
      }
      if (enqueueOpts?.idempotencyKey) seenKeys.add(enqueueOpts.idempotencyKey);

      const id = enqueueOpts?.idempotencyKey ?? crypto.randomUUID();

      if (!binding) {
        console.warn(`[cf-queue:${queueName}] no binding — stub enqueue id=${id}`);
        return id;
      }

      try {
        const body = { id, payload, enqueuedAt: new Date().toISOString() };
        await binding.send(body);
        return id;
      } catch (err) {
        console.error(
          `[cf-queue:${queueName}] send failed id=${id} ${String((err as Error).message ?? err)}`
        );
        throw err;
      }
    },

    process(_handler: (msg: QueueMessage<T>) => Promise<void>): void {
      // In Workers, consumption is via `export default { async queue(batch) }`, not process().
      // Keep no-op to preserve interface symmetry; real consumer wired in worker.ts queue handler.
      console.warn(
        `[cf-queue:${queueName}] process() is no-op on Workers — use queue(batch) handler`
      );
    },
  };
}

// Factory alias for DI container — reads binding from env
export function createCfQueueFromEnv<T>(
  env: Record<string, unknown>,
  bindingName = "QUEUE"
): Queue<T> {
  const binding = env[bindingName] as CfQueueBinding | undefined;
  return createCfQueue<T>(binding);
}
