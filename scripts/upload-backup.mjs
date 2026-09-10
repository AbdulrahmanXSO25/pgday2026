/**
 * §32.2 — upload a file to R2 via the S3-compatible API (used by backup.yml).
 * Usage: node scripts/upload-backup.mjs <local-file> <r2-key>
 */
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";

const [file, key] = process.argv.slice(2);
if (!file || !key) {
  console.error("usage: node upload-backup.mjs <file> <key>");
  process.exit(1);
}

const client = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});

await client.send(
  new PutObjectCommand({
    Bucket: process.env.R2_BUCKET ?? "pgegypt-media",
    Key: key,
    Body: readFileSync(file),
    ContentType: "application/x-sqlite3",
  }),
);
console.log(`[upload-backup] uploaded ${file} -> ${key}`);
