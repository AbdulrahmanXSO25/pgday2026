import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "../../migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DB_FILE ?? "./data/local.db",
  },
  verbose: true,
  strict: true,
});
