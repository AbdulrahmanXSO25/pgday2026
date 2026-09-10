import { defineWorkspace } from "vitest/config";

/**
 * Alternative workspace entry for `vitest --workspace` (some CI uses this name).
 * Delegates to same projects as vitest.config.ts root.
 */
export default defineWorkspace([
  "packages/db/vitest.config.ts",
  "packages/validation/vitest.config.ts",
  "packages/auth/vitest.config.ts",
  "packages/publish/vitest.config.ts",
  "apps/api/vitest.config.ts",
]);
