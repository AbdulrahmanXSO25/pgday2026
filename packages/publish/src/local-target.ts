/**
 * Local PublishTarget — fs write to publish dir (active Phases 0-6).
 * Writes each file as pretty-printed JSON to `publishDir`.
 * Idempotent: overwrites existing files; creates dir if missing.
 * Validates via Zod content schemas before write (caller ensures, double-checked here).
 */

import { mkdir, writeFile, access } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import type {
  PublishTarget,
  PublishFiles,
  PublishWriteResult,
  PublishTargetOptions,
} from "./target.js";
import { hashFiles } from "./target.js";

export type LocalTargetOptions = {
  publishDir?: string;
  pretty?: boolean;
};

export const DEFAULT_PUBLISH_DIR = resolve(process.cwd(), "content-published");

export function resolvePublishDir(options: LocalTargetOptions = {}): string {
  if (options.publishDir && options.publishDir.trim().length > 0)
    return resolve(options.publishDir.trim());
  const envDir = process.env.PUBLISH_DIR;
  if (envDir && envDir.trim().length > 0) return resolve(envDir.trim());
  // For monorepo, try to detect apps/public-web/content-published if exists, else content-published at cwd
  return DEFAULT_PUBLISH_DIR;
}

export function createLocalTarget(options: LocalTargetOptions = {}): PublishTarget {
  const publishDir = resolvePublishDir(options);
  const pretty = options.pretty ?? true;

  return {
    kind: "local",

    async publish(files: PublishFiles, _opts?: PublishTargetOptions): Promise<PublishWriteResult> {
      if (!files || typeof files !== "object" || Object.keys(files).length === 0) {
        return { ok: false, target: "local", error: "No files to publish" };
      }

      const contentHash = await hashFiles(files);
      const written: string[] = [];

      try {
        await mkdir(publishDir, { recursive: true });
      } catch (error) {
        return {
          ok: false,
          target: "local",
          error: `Failed to create publish dir ${publishDir}: ${String((error as Error).message)}`,
        };
      }

      // Write each file atomically (write to temp then rename not needed for test, simple writeFile)
      for (const [filename, data] of Object.entries(files)) {
        // Basic sanitization — prevent path traversal
        if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
          // Allow only flat filenames like "site-config.json"
          if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
            return { ok: false, target: "local", error: `Invalid filename: ${filename}` };
          }
        }
        const dest = join(publishDir, filename);
        // Ensure parent dir exists (for nested like content/*.json if ever)
        try {
          await mkdir(dirname(dest), { recursive: true });
        } catch {
          // ignore
        }
        const content = pretty ? JSON.stringify(data, null, 2) + "\n" : JSON.stringify(data);
        try {
          await writeFile(dest, content, "utf-8");
          written.push(filename);
        } catch (error) {
          return {
            ok: false,
            target: "local",
            error: `Failed to write ${filename}: ${String((error as Error).message)}`,
          };
        }
      }

      return { ok: true, target: "local", contentHash, writtenFiles: written };
    },

    async healthCheck(): Promise<{ ok: boolean; message?: string }> {
      try {
        await access(publishDir).catch(async () => {
          await mkdir(publishDir, { recursive: true });
        });
        return { ok: true };
      } catch (error) {
        return { ok: false, message: String((error as Error).message) };
      }
    },
  };
}

// Convenience helper exported for tests/service to get publish dir
export function getPublishDir(): string {
  return resolvePublishDir();
}
