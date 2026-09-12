/**
 * R2 + repository_dispatch PublishTarget (§16, production).
 *
 * Writes the assembled content snapshot to R2 at
 *   content-snapshots/{eventSlug}/latest/{site-config,speakers,...}.json
 * (the exact layout scripts/fetch-content-snapshot.mjs reads), then triggers
 * a GitHub `repository_dispatch` (event_type "publish") so CI rebuilds and
 * redeploys public-web.
 *
 * Workers-safe: uses the R2_BUCKET binding (.put) and global fetch only —
 * no node:fs, no AWS SDK.
 */

import type { PublishTarget, PublishFiles, PublishWriteResult } from "./target.js";
import { hashFiles } from "./target.js";

/** Structural subset of the R2Bucket binding we need (keeps this package free of @cloudflare/workers-types). */
export type R2BucketLike = {
  put: (key: string, value: string | ArrayBuffer | ReadableStream) => Promise<unknown>;
};

export type R2TargetOptions = {
  bucket?: R2BucketLike | null;
  /** Event slug used in the snapshot prefix. Defaults to "pgegypt-2026". */
  eventSlug?: string;
  /** "owner/repo" that hosts the deploy-public-web.yml workflow. */
  repo?: string;
  /** Fine-grained PAT with Actions:write (dispatches) on that repo. */
  token?: string;
  /** repository_dispatch event type the workflow listens for. */
  dispatchEvent?: string;
};

export const DEFAULT_EVENT_SLUG = "pgegypt-2026";
export const DEFAULT_DISPATCH_EVENT = "publish";

function snapshotKey(slug: string, filename: string): string {
  return `content-snapshots/${slug}/latest/${filename}`;
}

export function createR2Target(options: R2TargetOptions = {}): PublishTarget {
  const dispatchEvent =
    (options.dispatchEvent ?? DEFAULT_DISPATCH_EVENT).trim() || DEFAULT_DISPATCH_EVENT;

  return {
    kind: "r2",

    async publish(files: PublishFiles, opts?: { eventSlug?: string }): Promise<PublishWriteResult> {
      const slug =
        (opts?.eventSlug ?? options.eventSlug ?? DEFAULT_EVENT_SLUG).trim() || DEFAULT_EVENT_SLUG;

      if (!options.bucket) {
        return {
          ok: false,
          target: "r2",
          error:
            "R2 publish target has no bucket — bind R2_BUCKET (bucket pgegypt-media) to the api Worker.",
        };
      }
      if (!options.repo || !options.token) {
        return {
          ok: false,
          target: "r2",
          error:
            "R2 publish target needs GITHUB_REPO (owner/repo) and GITHUB_DISPATCH_TOKEN (Actions:write) to trigger the site rebuild.",
        };
      }

      const names = Object.keys(files).sort();
      try {
        for (const name of names) {
          await options.bucket.put(snapshotKey(slug, name), JSON.stringify(files[name], null, 2));
        }
      } catch (error) {
        return {
          ok: false,
          target: "r2",
          error: `R2 snapshot upload failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }

      const contentHash = await hashFiles(files);

      let dispatchRes: Response;
      try {
        dispatchRes = await fetch(`https://api.github.com/repos/${options.repo}/dispatches`, {
          method: "POST",
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${options.token}`,
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
            "User-Agent": "pgegypt-publish-worker",
          },
          body: JSON.stringify({ event_type: dispatchEvent }),
        });
      } catch (error) {
        return {
          ok: false,
          target: "r2",
          error: `GitHub dispatch request failed: ${error instanceof Error ? error.message : String(error)} (snapshot is in R2; site rebuild was NOT triggered)`,
        };
      }
      if (dispatchRes.status !== 204) {
        let detail = "";
        try {
          detail = ` ${(await dispatchRes.text()).slice(0, 200)}`;
        } catch {
          // ignore body read errors
        }
        return {
          ok: false,
          target: "r2",
          error: `GitHub dispatch failed with HTTP ${dispatchRes.status}.${detail} (snapshot is in R2; site rebuild was NOT triggered)`,
        };
      }

      return { ok: true, target: "r2", contentHash, writtenFiles: names };
    },

    async healthCheck(): Promise<{ ok: boolean; message?: string }> {
      if (!options.bucket) return { ok: false, message: "R2_BUCKET binding not configured" };
      if (!options.repo || !options.token)
        return { ok: false, message: "GITHUB_REPO / GITHUB_DISPATCH_TOKEN not configured" };
      return { ok: true };
    },
  };
}

/**
 * Factory helper — returns the requested target.
 * NOTE: for "local", import createLocalTarget directly (keeps this module free of node:fs for Workers).
 */
export function createPublishTarget(
  kind: "local" | "r2" = "local",
  options: R2TargetOptions = {}
): PublishTarget {
  if (kind === "r2") return createR2Target(options);
  throw new Error(
    "createPublishTarget(local) is not supported here — import createLocalTarget directly"
  );
}
