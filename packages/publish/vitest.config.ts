import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    environment: "node",
    testTimeout: 10000,
    hookTimeout: 10000,
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text"],
      include: ["src/**/*.ts"],
      thresholds: { lines: 80, branches: 75, functions: 80, statements: 80 },
    },
  },
});
