import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({
  // Admin is a private dashboard — no ISR/DO/KV needed either (§8).
});
