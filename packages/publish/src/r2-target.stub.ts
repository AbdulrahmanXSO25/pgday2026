/**
 * R2 + repository_dispatch PublishTarget — stub for Phases 0-6 (§16).
 * In Phase 7 this will upload to R2 (S3-compatible) and trigger GitHub
 * repository_dispatch to rebuild public-web from content/*.json in R2.
 *
 * Currently throws NOT_IMPLEMENTED — local target is active.
 * Interface preserved so service can switch via env PUBLISH_TARGET=r2 without
 * code change.
 */

import type { PublishTarget, PublishFiles, PublishWriteResult } from "./target.js";

export type R2TargetOptions = {
  bucket?: string;
  endpoint?: string;
  repoDispatchUrl?: string;
};

export function createR2Target(_options: R2TargetOptions = {}): PublishTarget {
  return {
    kind: "r2",

    async publish(_files: PublishFiles): Promise<PublishWriteResult> {
      // Stub — not active in Phases 0-6
      return {
        ok: false,
        target: "r2",
        error:
          "R2 publish target not implemented in Phases 0-6 — use local target. Set PUBLISH_TARGET=local.",
      };
    },

    async healthCheck(): Promise<{ ok: boolean; message?: string }> {
      return { ok: false, message: "R2 target stub — not implemented until Phase 7" };
    },
  };
}

/**
 * Factory helper — returns correct target based on env.
 * Phases 0-6 default to local.
 */
export function createPublishTarget(
  kind: "local" | "r2" = "local",
  options: R2TargetOptions = {}
): PublishTarget {
  if (kind === "r2") return createR2Target(options);
  // For local, caller should import createLocalTarget directly to avoid circular deps.
  // Lazy import kept simple — we return a stub that delegates to real local target when invoked.
  // This keeps R2 stub free of fs imports for Workers.
  return {
    kind: "local" as const,
    async publish(files: PublishFiles): Promise<PublishWriteResult> {
      return {
        ok: false,
        target: "local",
        error: "createPublishTarget(local) stub — import createLocalTarget directly",
      };
    },
  };
}
