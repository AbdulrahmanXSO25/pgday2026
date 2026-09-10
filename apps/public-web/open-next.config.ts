import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({
  // public-web is static-first (§7.2) — full-rebuild publish model, no ISR/DO/KV.
});
