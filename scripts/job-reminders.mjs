/**
 * §25.4 — event reminder job (local). Prod uses a Cloudflare Cron Trigger on api.
 * Queries confirmed registrations for the active event and prints reminder emails
 * (best-effort; local dev can pipe to Maildev via the mailer).
 * Usage: pnpm job:reminders
 */
import Database from "better-sqlite3";
import { resolve } from "node:path";

const dbFile = process.env.DB_FILE ?? resolve("packages/db/data/local.db");
const db = new Database(dbFile);

const event = db
  .prepare("SELECT id, name, date FROM events WHERE status='active' OR status='draft' ORDER BY created_at LIMIT 1")
  .get() as { id: string; name: string; date: string } | undefined;
if (!event) {
  console.error("[job:reminders] no active event found");
  process.exit(1);
}

const rows = db
  .prepare("SELECT id, name, email FROM registrations WHERE event_id=? AND status='confirmed'")
  .all(event.id) as Array<{ id: string; name: string; email: string }>;

for (const r of rows) {
  const subject = `Reminder: ${event.name} is on ${event.date}`;
  const html = `<p>Hi ${r.name}, this is a reminder that ${event.name} takes place on ${event.date}.</p>`;
  console.log(`[job:reminders] would send to ${r.email}: ${subject}`);
  // In local dev, wire to Maildev via packages/mail createMaildevMailer if desired.
  void html;
}
console.log(`[job:reminders] done — ${rows.length} confirmed registrant(s)`);
db.close();