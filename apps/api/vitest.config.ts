import { defineConfig } from "vitest/config";
import path from "node:path";

const alias = {
  "@pgegypt/validation": path.resolve(__dirname, "../../packages/validation/src/index.ts"),
  "@pgegypt/types": path.resolve(__dirname, "../../packages/types/src/index.ts"),
  "@pgegypt/config": path.resolve(__dirname, "../../packages/config/src/index.ts"),
  "@pgegypt/db": path.resolve(__dirname, "../../packages/db/src/index.ts"),
  "@pgegypt/auth": path.resolve(__dirname, "../../packages/auth/src/index.ts"),
  "@pgegypt/queue": path.resolve(__dirname, "../../packages/queue/src/index.ts"),
  "@pgegypt/mail": path.resolve(__dirname, "../../packages/mail/src/index.ts"),
  "@pgegypt/storage": path.resolve(__dirname, "../../packages/storage/src/index.ts"),
  "@pgegypt/publish": path.resolve(__dirname, "../../packages/publish/src/index.ts"),
};

export default defineConfig({
  resolve: { alias },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 10000,
    hookTimeout: 10000,
    fileParallelism: false,
  },
});
