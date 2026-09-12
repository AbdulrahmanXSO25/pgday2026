/**
 * §16.2 — fetch the published content snapshot from R2 into apps/public-web/content/
 * before `next build`. Runs on EVERY public-web deploy (code push or publish),
 * so the live site always reflects the latest published content.
 *
 * Behavior:
 * - R2 env absent (local) → no-op, keep committed content.
 * - Snapshot exists → overwrite committed content with the published snapshot.
 * - Snapshot missing (no publish yet) → keep committed content, do NOT fail.
 * - Malformed snapshot → fail loudly (a broken snapshot must never ship).
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

let wroteAny = false;
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
    wroteAny = true;
    console.log(`[fetch-content-snapshot] wrote ${file} from ${key}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Missing snapshot (no publish yet) → keep committed content.
    if (/NoSuchKey|404|not found/i.test(msg)) {
      console.log(`[fetch-content-snapshot] no snapshot for ${key} — keeping committed content.`);
      continue;
    }
    // Malformed or other error → fail loudly.
    console.error(`[fetch-content-snapshot] failed ${key}: ${msg}`);
    process.exit(1);
  }
}
console.log(
  wroteAny
    ? "[fetch-content-snapshot] done — published snapshot applied."
    : "[fetch-content-snapshot] done — no snapshot found, using committed content."
);