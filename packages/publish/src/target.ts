/**
 * PublishTarget interface — local (fs write) vs R2 + repository_dispatch (§16).
 * Local is active in Phases 0-6; R2 is stubbed until Phase 7.
 * Explicit publishing only — no per-write ISR; full rebuild required.
 * Idempotent: same content hash → same files overwritten, no duplicate error.
 */

export type PublishTargetKind = "local" | "r2";

export type PublishFiles = Record<string, unknown>;

export type PublishWriteResult = {
  ok: boolean;
  target: PublishTargetKind;
  contentHash?: string;
  writtenFiles?: string[];
  error?: string;
};

export interface PublishTarget {
  readonly kind: PublishTargetKind;
  /**
   * Write assembled content files to the target.
   * Files keys are like "site-config.json", "speakers.json" etc.
   * Must be idempotent — overwriting with same content succeeds.
   */
  publish(files: PublishFiles): Promise<PublishWriteResult>;

  /**
   * Optional: check if target is available (e.g., fs writable / R2 creds present).
   */
  healthCheck?(): Promise<{ ok: boolean; message?: string }>;
}

/** Pure helper — deterministic SHA-256 hex of sorted JSON files map */
export async function hashFiles(files: PublishFiles): Promise<string> {
  const keys = Object.keys(files).sort();
  const payload = keys.map((k) => `${k}:${JSON.stringify(files[k])}`).join("\n");
  try {
    const { createHash } = await import("node:crypto");
    return createHash("sha256").update(payload).digest("hex");
  } catch {
    const enc = new TextEncoder();
    const data = enc.encode(payload);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
}

export function hashFilesSync(files: PublishFiles): string {
  const keys = Object.keys(files).sort();
  const payload = keys.map((k) => `${k}:${JSON.stringify(files[k])}`).join("\n");
  // Sync version: use simple deterministic hash to avoid import.meta / require issues in ESM/CJS dual
  // Async hashFiles() provides real SHA256; sync is fallback for legacy callers
  let hash = 0;
  for (let i = 0; i < payload.length; i++) {
    const chr = payload.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}
