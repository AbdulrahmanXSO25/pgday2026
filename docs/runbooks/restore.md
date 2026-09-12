# Restore Procedure

What to do when something goes wrong with the database.

## First line of defense: D1 Time Travel

For recent mistakes (a fat-fingered delete 10 minutes ago), use **D1 Time Travel** — it's instant and doesn't need the backup:

```bash
# Find a timestamp before the mistake
wrangler d1 time-travel info pgegypt-db

# Restore to that point (creates a new database)
wrangler d1 time-travel restore pgegypt-db --timestamp=<unix-seconds>
```

Then point the API worker's `DB` binding at the restored database.

## Full restore from the R2 backup

For bigger problems (database lost, corrupted), restore from the daily backup:

1. **Provision a new D1 database** (Dashboard → D1 → Create, or `wrangler d1 create`).
2. **Apply all migrations** in order:
   ```bash
   wrangler d1 migrations apply <new-db> --remote
   ```
3. **Download the latest backup** from R2 (`backups/pgegypt-2026/<date>/db.sql`) — via the S3 API or the dashboard.
4. **Load it**:
   ```bash
   wrangler d1 execute <new-db> --remote --file db.sql
   ```
5. **Point the API worker** at the restored database (update `database_id` in `apps/api/wrangler.jsonc`, redeploy).

## Backups

`backup.yml` runs daily at 03:00 UTC and uploads a full D1 export to R2 under `backups/pgegypt-2026/<date>/db.sql`. The bucket keeps 30 days.

## Before you restore

- **Test the restore path once** on a scratch database before you need it for real. A backup you've never restored is a hope, not a plan.
- Restoring overwrites data. If you're unsure, restore to a **new** database first and inspect it before switching over.
