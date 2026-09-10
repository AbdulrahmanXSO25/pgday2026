import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Workspace root — coordinates Vitest across api, db, and packages.
 * Each project reuses its own vitest.config.ts where present; workspace
 * adds coverage orchestration with >=80% thresholds on critical paths.
 */
export default defineConfig({
  test: {
    // Workspace mode delegates to projects below
    workspace: [
      "packages/db/vitest.config.ts",
      "packages/validation/vitest.config.ts",
      "packages/auth/vitest.config.ts",
      "packages/publish/vitest.config.ts",
      "apps/api/vitest.config.ts",
    ],
    // Global thresholds — critical paths (schemas/services/routes)
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      reportsDirectory: "./coverage",
      // 80% on critical paths; relaxed globally to avoid false fails on UI
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
      include: [
        "apps/api/src/services/**/*.{ts,tsx}",
        "apps/api/src/routes/**/*.{ts,tsx}",
        "packages/validation/src/**/*.{ts,tsx}",
        "packages/db/src/**/*.{ts,tsx}",
        "packages/publish/src/**/*.{ts,tsx}",
      ],
      exclude: [
        "node_modules/**",
        "**/*.test.ts",
        "**/*.spec.ts",
        "**/dist/**",
        "**/.next/**",
        "**/coverage/**",
      ],
    },
  },
  resolve: {
    alias: {
      "@pgegypt/validation": path.resolve(__dirname, "packages/validation/src/index.ts"),
      "@pgegypt/types": path.resolve(__dirname, "packages/types/src/index.ts"),
      "@pgegypt/config": path.resolve(__dirname, "packages/config/src/index.ts"),
      "@pgegypt/db": path.resolve(__dirname, "packages/db/src/index.ts"),
      "@pgegypt/auth": path.resolve(__dirname, "packages/auth/src/index.ts"),
      "@pgegypt/queue": path.resolve(__dirname, "packages/queue/src/index.ts"),
      "@pgegypt/mail": path.resolve(__dirname, "packages/mail/src/index.ts"),
      "@pgegypt/storage": path.resolve(__dirname, "packages/storage/src/index.ts"),
      "@pgegypt/publish": path.resolve(__dirname, "packages/publish/src/index.ts"),
      "@pgegypt/ui": path.resolve(__dirname, "packages/ui/src/index.ts"),
    },
  },
});
