import { defineConfig } from "vitest/config";
import path from "node:path";
import { createRequire } from "node:module";

// Resolve native/ORM deps from packages/db (they live in the workspace, not root)
const req = createRequire(path.resolve(__dirname, "../packages/db/package.json"));

export default defineConfig({
  test: {
    include: ["e2e/*.spec.ts"],
    exclude: ["e2e/a11y-visual.spec.ts", "e2e/a11y-portal.spec.ts", "e2e/cross-browser.spec.ts"], // Playwright (browser) specs — not Vitest specs
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: [
      // Exact matches first ($ suffix) to avoid prefix collisions
      {
        find: /^drizzle-orm\/better-sqlite3$/,
        replacement: req.resolve("drizzle-orm/better-sqlite3"),
      },
      { find: /^drizzle-orm$/, replacement: req.resolve("drizzle-orm") },
      { find: /^better-sqlite3$/, replacement: req.resolve("better-sqlite3") },
      { find: "@pgegypt/db", replacement: path.resolve(__dirname, "../packages/db/src/index.ts") },
      {
        find: "@pgegypt/auth",
        replacement: path.resolve(__dirname, "../packages/auth/src/index.ts"),
      },
      {
        find: "@pgegypt/validation",
        replacement: path.resolve(__dirname, "../packages/validation/src/index.ts"),
      },
      {
        find: "@pgegypt/storage",
        replacement: path.resolve(__dirname, "../packages/storage/src/index.ts"),
      },
      {
        find: "@pgegypt/publish",
        replacement: path.resolve(__dirname, "../packages/publish/src/index.ts"),
      },
      {
        find: "@pgegypt/mail",
        replacement: path.resolve(__dirname, "../packages/mail/src/index.ts"),
      },
      {
        find: "@pgegypt/queue",
        replacement: path.resolve(__dirname, "../packages/queue/src/index.ts"),
      },
      {
        find: "@pgegypt/types",
        replacement: path.resolve(__dirname, "../packages/types/src/index.ts"),
      },
      {
        find: "@pgegypt/config",
        replacement: path.resolve(__dirname, "../packages/config/src/index.ts"),
      },
    ],
  },
});
