# PG Day Egypt — Deployment & Config Injection Checklist (Phase 7)

Everything in Phases 0–6 is local-first and Cloudflare-free. This document is the
**only** remaining work to go live: provisioning Cloudflare resources, injecting
secrets/config, and running the deploy workflows. No application code changes are
required — the adapters in `packages/{db,storage,queue,mail,publish}` already branch
on `RUNTIME`/env.

## 1. Prerequisites

- Cloudflare account with Workers, D1, R2, Queues enabled.
- GitHub repo with Environments (`staging`, `production`) and required reviewers on `production`.
- Node 22 + pnpm 9 locally (for the one-time provisioning commands).

## 2. Provision Cloudflare resources

```bash
# D1 databases (staging + production)
wrangler d1 create pgegypt-db-staging
wrangler d1 create pgegypt-db

# R2 bucket (single bucket; content-snapshots/ + backups/ prefixes)
wrangler r2 bucket create pgegypt-media

# Queue
wrangler queues create pgegypt-email-queue
```

Update `apps/api/wrangler.jsonc` with the real `database_id`s and queue name.

## 3. Secrets (never commit — `wrangler secret put`)

| Secret                                                      | Where                      | Used by                                                           |
| ----------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------- |
| `RESEND_API_KEY`                                            | api Worker                 | `packages/mail` (Resend)                                          |
| `EMAIL_FROM`                                                | api Worker                 | mailer from-address                                               |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`                 | api Worker                 | R2 S3-compatible access (R2 API token)                            |
| `S3_ENDPOINT`                                               | api Worker                 | `https://<account_id>.r2.cloudflarestorage.com`                   |
| `S3_BUCKET`                                                 | api Worker                 | `pgegypt-media`                                                   |
| `GITHUB_DISPATCH_TOKEN`                                     | api Worker                 | `repository_dispatch` publish trigger (PAT with `actions: write`) |
| `GITHUB_REPO`                                               | api Worker                 | `owner/repo` for dispatch                                         |
| `CLOUDFLARE_API_TOKEN`                                      | GitHub Environment secrets | deploy workflows                                                  |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_ENDPOINT` | GitHub Environment secrets | `fetch-content-snapshot.mjs`, `backup.yml`                        |

```bash
cd apps/api
wrangler secret put RESEND_API_KEY
wrangler secret put EMAIL_FROM
wrangler secret put S3_ACCESS_KEY_ID
wrangler secret put S3_SECRET_ACCESS_KEY
wrangler secret put S3_ENDPOINT
wrangler secret put S3_BUCKET
wrangler secret put GITHUB_DISPATCH_TOKEN
wrangler secret put GITHUB_REPO
```

## 4. DNS

- `https://pgegypt-public-web.abdulrahmannader-123.workers.dev` → `pgegypt-public-web` Worker (proxied)
- `https://pgegypt-admin-web.abdulrahmannader-123.workers.dev` → `pgegypt-admin-web` Worker (proxied)
- `https://pgegypt-api.abdulrahmannader-123.workers.dev` → `pgegypt-api` Worker (proxied)
- (optional) `media.pgegypt.org` → R2 public bucket for hotlinked images

Update `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_API_BASE_URL`, `API_BASE_URL` vars in the
three `wrangler.jsonc` files to the real hostnames.

## 5. Bootstrap data (production D1)

```bash
# After first deploy-api run applies migrations:
wrangler d1 execute pgegypt-db --remote --command \
  "INSERT INTO events (id, slug, name, date, date_display, city, venue_status, timezone, status, settings_json) VALUES ('evt_00000000-0000-7000-8000-000000000001','pgegypt-2026','PG Day Egypt 2026','2026-10-10','Saturday, October 10, 2026','Cairo, Egypt','tba','Africa/Cairo','active','{}');"
# Create the first SUPER_ADMIN (hash via packages/auth hashPassword, e.g. a one-off script)
```

## 6. GitHub Environments

- Create `staging` and `production` environments.
- Add `CLOUDFLARE_API_TOKEN` (+ R2 vars) to both.
- Enable "Required reviewers" on `production`.

## 7. Deploy order

1. `deploy-api.yml` (migrations + Worker) — staging auto, production gated.
2. `deploy-admin-web.yml` — staging auto, production gated.
3. `deploy-public-web.yml` — push-triggered; publish-triggered via `repository_dispatch`.
4. `backup.yml` — daily D1 export → R2 (`backups/…`, 30-day lifecycle rule on the bucket).

## 8. Post-deploy verification

- `curl https://pgegypt-api.abdulrahmannader-123.workers.dev/v1/health` → `{"success":true,"status":"ok"}`
- Login at `https://pgegypt-admin-web.abdulrahmannader-123.workers.dev/login` with the bootstrap SUPER_ADMIN.
- `POST /v1/publish` from admin → verify `apps/public-web/content/*.json` snapshot in R2
  (`content-snapshots/pgegypt-2026/latest/`) and the public site rebuild.
- Register via `https://pgegypt-public-web.abdulrahmannader-123.workers.dev/register` → confirmation email via Resend.
- Check-in a confirmed registration via admin `/checkin`.

## 9. Rollback

- D1: Time Travel (point-in-time) for fat-fingered deletes; R2 `backups/…` for full restore.
- Public site: re-run `deploy-public-web.yml` with an older `content-snapshots/…` key
  (manual `workflow_dispatch` input).

## 10. Production operations (Q6 hardening)

### Secrets on the API worker (set once)

```bash
wrangler secret put RESEND_API_KEY          # Resend dashboard
wrangler secret put GITHUB_DISPATCH_TOKEN   # fine-grained PAT, contents:write on this repo
wrangler secret put R2_ACCOUNT_ID           # ab4321ff2699dcc01b47d264c605abb8
wrangler secret put R2_ACCESS_KEY_ID        # R2 API token (pgegypt-media, Object Read & Write)
wrangler secret put R2_SECRET_ACCESS_KEY    # same token
wrangler secret put R2_BUCKET_NAME          # pgegypt-media
```

Until `RESEND_API_KEY` is set, transactional emails are enqueued but not delivered.
Until the R2 token secrets are set, media presigned uploads return a clear 500.

### Staging environment (recommended before the event)

- Add `[env.staging]` blocks to `apps/api/wrangler.jsonc` (own D1 `pgegypt-db-staging`,
  R2 bucket or prefix, Queue) and deploy from a `staging` branch.
- Pages gives per-branch preview URLs for the frontends automatically.

### Backup restore drill

- Run once: `wrangler d1 time-travel restore pgegypt-db --timestamp=<T>` against a scratch DB
  to confirm the restore path works before you need it.
- `backup.yml` exports D1 → R2 daily (`backups/pgegypt-2026/<date>/db.sql`).

### Email deliverability (Resend)

- Verify `pgegypt.org` in Resend: add the SPF TXT + 3 DKIM CNAME records it provides.
- Add DMARC: `v=DMARC1; p=quarantine; rua=mailto:postmaster@pgegypt.org`.
- Without SPF+DKIM+DMARC, CFP/registration emails risk spam or rejection.

### Data retention (PII)

- Attendee PII (names, emails) lives in D1 `registrations` + `audit_logs` (redacted).
- Document a retention policy: e.g., keep registrations 12 months post-event, then purge
  (`DELETE` + D1 Time Travel backup retained). Check-in tokens are stored hashed.

### Load testing before the event

- Registration/CFP traffic is spiky (announcement bursts). Run a synthetic burst against
  `/v1/registrations` + `/v1/cfp/submissions` (rate limit is 5/hour/IP — use distinct IPs
  or a load-test account) and watch D1 concurrency + Queue backpressure.

### Migration rollback

- Migrations 0001–0007 are forward-only. Rollback = restore from D1 Time Travel / R2 backup.
  This is a documented decision, not an open question.

### Observability

- Workers Logs enabled on all three workers (`observability.enabled`).
- Add error-rate alerts in the Cloudflare dashboard; consider Sentry
  (`@sentry/cloudflare`) for exception tracking with the same PII-redaction discipline.
