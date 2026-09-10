import type { EnqueueOptions, Queue, QueueMessage } from "./interface.js";

/**
 * In-process async queue — local dev replacement for Cloudflare Queue.
 * - enqueue returns id immediately, handlers fired async via queueMicrotask
 * - idempotency via Set of idempotencyKey if provided
 * - process registers handlers; multiple consumers supported
 * Pure DI, no global singleton except per-instance state.
 */

export function createLocalQueue<T>(): Queue<T> {
  const handlers: Array<(msg: QueueMessage<T>) => Promise<void>> = [];
  const seenKeys = new Set<string>();
  const pending = new Map<string, QueueMessage<T>>();

  return {
    async enqueue(payload: T, opts?: EnqueueOptions): Promise<string> {
      // Deduplicate via idempotencyKey — return existing id without re-enqueue
      if (opts?.idempotencyKey) {
        if (seenKeys.has(opts.idempotencyKey)) {
          // Find existing pending id for same key if any; otherwise return key hash as id
          for (const [id, msg] of pending.entries()) {
            void msg;
            if (id === opts.idempotencyKey) return id;
          }
          return opts.idempotencyKey;
        }
        seenKeys.add(opts.idempotencyKey);
      }

      const id = opts?.idempotencyKey ?? crypto.randomUUID();
      const msg: QueueMessage<T> = {
        id,
        payload,
        attempts: 0,
        enqueuedAt: new Date().toISOString(),
      };

      if (opts?.idempotencyKey) pending.set(id, msg);

      // Fire handlers async — best-effort, no await in enqueue path
      const run = () => {
        for (const h of handlers) {
          void h(msg).catch((err) => {
            // Structured error without exposing payload PII
            console.error(
              `[queue] handler error id=${id} ${String((err as Error).message ?? err)}`
            );
          });
        }
      };

      if (opts?.delayMs && opts.delayMs > 0) {
        setTimeout(run, opts.delayMs);
      } else {
        queueMicrotask(run);
      }

      return id;
    },

    process(handler: (msg: QueueMessage<T>) => Promise<void>): void {
      handlers.push(handler);
    },
  };
}

// Backward-compatible alias — used by existing code/tests
export const createInMemoryQueue = createLocalQueue;

// Test helper: queue that exposes pending for assertions (internal)
export type TestLocalQueue<T> = Queue<T> & { __seenKeys: Set<string> };
