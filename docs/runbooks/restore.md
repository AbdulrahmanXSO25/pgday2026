# Restore Procedure (§32.2)

1. Provision a new D1 database (or `wrangler d1 execute --local` against a scratch file for a dry run).
2. Apply all migrations in order: `wrangler d1 migrations apply <db> --remote`.
3. Load the most recent `backups/<event-slug>/<date>/db.sql` snapshot from R2
   (download via S3 API, then `wrangler d1 execute <db> --remote --file db.sql`).
4. Point the `api` Worker's `DB` binding at the restored database.

First line of defense for recent mistakes is **D1 Time Travel** (point-in-time recovery),
not the R2 snapshot — use Time Travel for "I fat-fingered a delete 10 minutes ago".
