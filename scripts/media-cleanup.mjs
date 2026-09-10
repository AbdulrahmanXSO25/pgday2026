/**
 * §17.6 — media cleanup: delete `pending` media rows/objects older than 24h.
 * Local dev script (prod uses a Cloudflare Cron Trigger on api).
 * Usage: pnpm media:cleanup
 */
import Database from "better-sqlite3";
import { resolve } from "node:path";

const dbFile = process.env.DB_FILE ?? resolve("packages/db/data/local.db");
const db = new Database(dbFile);
const cutoff = Math.floor(Date.now() / 1000) - 24 * 60 * 60;

const rows = db
  .prepare("SELECT id, storage_key FROM media WHERE status='pending' AND created_at < ?")
  .all(cutoff) as Array<{ id: string; storage_key: string }>;

for (const row of rows) {
  // Best-effort storage delete (MinIO/R2) — row removal is authoritative locally
  try {
    db.prepare("DELETE FROM media WHERE id=?").run(row.id);
    console.log(`[media-cleanup] removed pending media ${row.id} (${row.storage_key})`);
  } catch (err) {
    console.error(`[media-cleanup] failed ${row.id}:`, err instanceof Error ? err.message : String(err));
  }
}
console.log(`[media-cleanup] done — ${rows.length} stale pending upload(s) removed`);
db.close();