// Publishing pipeline — explicit publish, not per-write; local vs R2+repository_dispatch.
// Phases 0-6: local active. R2 stub until Phase 7.

export type {
  PublishTarget,
  PublishTargetKind,
  PublishFiles,
  PublishWriteResult,
} from "./target.js";
export { hashFiles, hashFilesSync } from "./target.js";
export {
  createLocalTarget,
  resolvePublishDir,
  getPublishDir,
  DEFAULT_PUBLISH_DIR,
} from "./local-target.js";
export type { LocalTargetOptions } from "./local-target.js";
export { createR2Target, createPublishTarget } from "./r2-target.stub.js";
export type { R2TargetOptions } from "./r2-target.stub.js";
export { assembleContent, validateAssembledFiles } from "./assemble.js";
export type { AssembleOptions } from "./assemble.js";
export {
  SpeakerSchema,
  ScheduleItemSchema,
  SponsorSchema,
  OrganizerSchema,
  FaqItemSchema,
  SiteConfigSchema,
} from "./assemble.js";

// Legacy placeholder kept for backwards compat — new code use PublishTarget interface
export type LegacyPublishTarget = "local" | "r2";
export type LegacyPublishResult =
  { ok: true; target: LegacyPublishTarget } | { ok: false; error: string };
export function createPublisher(target: LegacyPublishTarget = "local") {
  return {
    target,
    async publish(): Promise<LegacyPublishResult> {
      return { ok: true, target };
    },
  };
}
