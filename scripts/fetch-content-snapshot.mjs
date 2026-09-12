/**
 * §16.2 — fetch the published content snapshot from R2 into apps/public-web/content/
 * before `next build`. Runs in CI on a repository_dispatch(publish) trigger.
 * No-op if R2 env vars are absent (e.g., local or a plain code push).
 */
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const FILES = ["site-config.json", "speakers.json", "schedule.json", "sponsors.json", "organizers.json", "faq.json"];

const endpoint = process.env.R2_ENDPOINT;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const eventSlug = process.env.CONTENT_EVENT_SLUG ?? "pgegypt-2026";
// Exact snapshot id from the repository_dispatch client_payload — avoids the
// "latest" race between two close publishes. Falls back to latest/.
const snapshotId = process.env.CONTENT_SNAPSHOT_ID?.trim();
const destDir = process.argv[2] ?? "apps/public-web/content";

if (!endpoint || !accessKeyId || !secretAccessKey) {
  console.log("[fetch-content-snapshot] R2 env not set — using committed content/*.json (no-op).");
  process.exit(0);
}

const client = new S3Client({
  region: "auto",
  endpoint,
  credentials: { accessKeyId, secretAccessKey },
});

mkdirSync(destDir, { recursive: true });

for (const file of FILES) {
  const prefix = snapshotId
    ? `content-snapshots/${eventSlug}/${snapshotId}/${file}`
    : `content-snapshots/${eventSlug}/latest/${file}`;
  const key = prefix;
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET ?? "pgegypt-media", Key: key }));
    const body = await res.Body?.transformToString();
    if (!body) throw new Error("empty body");
    JSON.parse(body); // fail loudly on malformed snapshot
    writeFileSync(join(destDir, file), body);
    console.log(`[fetch-content-snapshot] wrote ${file} from ${key}`);
  } catch (err) {
    console.error(`[fetch-content-snapshot] failed ${key}: ${String(err)}`);
    process.exit(1);
  }
}
console.log("[fetch-content-snapshot] done");
