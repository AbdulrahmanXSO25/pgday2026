# Deployment Guide

How PG Day Egypt 2026 runs in production, and how to deploy it.

---

## The big picture

Three apps, one Cloudflare account:

| App         | Hosting                          | URL                                                  |
| ----------- | -------------------------------- | ---------------------------------------------------- |
| Public site | Cloudflare Pages (static export) | https://pgegypt-public-web.pages.dev                 |
| Admin panel | Cloudflare Pages (static export) | https://pgegypt-admin-web.pages.dev                  |
| API         | Cloudflare Worker                | https://pgegypt-api.abdulrahmannader-123.workers.dev |

Plus the data layer:

| Resource    | Name                                | Used for                                                  |
| ----------- | ----------------------------------- | --------------------------------------------------------- |
| D1 database | `pgegypt-db`                        | All app data                                              |
| R2 bucket   | `pgegypt-media`                     | Speaker photos, sponsor logos, content snapshots, backups |
| R2 bucket   | `pgegypt-public-web-opennext-cache` | (legacy OpenNext cache — no longer used)                  |
| R2 bucket   | `pgegypt-admin-web-opennext-cache`  | (legacy OpenNext cache — no longer used)                  |
| Queue       | `pgegypt-email`                     | Transactional email jobs                                  |
| Email       | Resend                              | Sends the emails (production)                             |

**Deploys are automatic.** Pushing to `master` triggers GitHub Actions, which builds and deploys each app. No manual steps.

---

## How a deploy works

### Public site + admin panel (Pages)

Both frontends are **static exports** (`next build` with `output: "export"`). They're plain HTML/JS/CSS on Cloudflare Pages — no server runtime.

The workflow (`deploy-public-web.yml`, `deploy-admin-web.yml`):

1. Install dependencies (`pnpm install --frozen-lockfile`)
2. Build the static export with the right env vars
3. Deploy with `wrangler pages deploy out --project-name=...`
4. Run a smoke check against the live URL

### API (Worker)

The API is a Hono app bundled into a Cloudflare Worker (`deploy-api.yml`):

1. Install dependencies
2. Apply D1 migrations (`wrangler d1 migrations apply pgegypt-db --remote`)
3. Deploy with `wrangler deploy`
4. Run a smoke check (health + CORS preflight)

---

## The publish pipeline

The public site is static, so content changes go through a **publish** step:

1. An organizer edits content in the admin panel and clicks **Publish now**.
2. The API reads the database, assembles a content snapshot (6 JSON files), and writes it to R2:
   `content-snapshots/{slug}/{snapshotId}/*.json` (plus a copy under `latest/`).
3. The API fires a GitHub `repository_dispatch` event with `{ slug, snapshotId }`.
4. GitHub Actions (`deploy-public-web.yml`, triggered by `repository_dispatch`) downloads that exact snapshot, rebuilds the site, and deploys to Pages.

**Result:** the live site reflects the database within a minute or two of clicking Publish.

### What gets published

Only **published** content appears on the site:

- Speakers and sessions must be marked **Published** in the admin (they start as drafts).
- Settings (event name, tagline, city, date, conference hours) apply immediately on publish.

---

## Secrets & environment

### API worker secrets (set once)

```bash
wrangler secret put RESEND_API_KEY          # Resend dashboard
wrangler secret put GITHUB_DISPATCH_TOKEN   # fine-grained PAT, Contents: read+write on this repo
wrangler secret put R2_ACCOUNT_ID           # Cloudflare account id
wrangler secret put R2_ACCESS_KEY_ID        # R2 API token (pgegypt-media, Object Read & Write)
wrangler secret put R2_SECRET_ACCESS_KEY    # same token
wrangler secret put R2_BUCKET_NAME          # pgegypt-media
```

### API worker vars (in `apps/api/wrangler.jsonc`)

`RUNTIME=production`, `API_BASE_URL`, `SITE_URL`, `EMAIL_FROM`, `GITHUB_REPO`, `MEDIA_PUBLIC_BASE_URL`.

### GitHub Actions secrets

| Secret                                                      | Used by                                                           |
| ----------------------------------------------------------- | ----------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`                                      | All deploys (needs Workers + Pages + D1 + R2 + Queue permissions) |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_ENDPOINT` | Publish-triggered snapshot fetch                                  |

### R2 bucket CORS

The `pgegypt-media` bucket needs a CORS policy so the browser can upload files directly to R2:

```json
[
  {
    "AllowedOrigins": [
      "https://pgegypt-admin-web.pages.dev",
      "https://pgegypt-public-web.pages.dev",
      "http://localhost:3000",
      "http://localhost:3001"
    ],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

---

## Adding a custom domain (when ready)

1. Add the domain to each Pages project (Dashboard → Pages → project → Custom domains).
2. Add a custom domain to the API worker (Dashboard → Workers → `pgegypt-api` → Settings → Domains).
3. Update the CORS allowlist in `apps/api/src/middleware/cors.ts`.
4. Update `connect-src` in both frontends' CSP (`_headers` + `next.config.ts`).
5. Update `NEXT_PUBLIC_*` / `API_BASE_URL` / `SITE_URL` in the deploy workflows.
6. Verify Resend SPF/DKIM/DMARC for the new domain.

---

## Rollback

- **Public site:** re-run `deploy-public-web.yml` manually, or publish an older snapshot.
- **API:** `wrangler rollback` (reverts to the previous deployment).
- **Database:** D1 Time Travel for recent mistakes; the R2 backup for full restore. See [docs/runbooks/restore.md](runbooks/restore.md).

---

## Backups

`backup.yml` runs daily (03:00 UTC): it exports the D1 database and uploads it to R2 under `backups/pgegypt-2026/<date>/db.sql`. The bucket has a 30-day lifecycle rule.

---

## Observability

- Workers Logs are enabled on the API worker.
- Post-deploy smoke checks run in every deploy workflow.
- For deeper monitoring, add error-rate alerts in the Cloudflare dashboard or wire up Sentry (`@sentry/cloudflare`).

---

## Common issues

| Symptom                                  | Cause / fix                                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Portrait upload fails in admin           | R2 bucket CORS policy missing, or `MEDIA_PUBLIC_BASE_URL` not set                                |
| Images 404 on the site                   | Media URL stored as a relative path — re-confirm the upload after `MEDIA_PUBLIC_BASE_URL` is set |
| Emails not arriving                      | `RESEND_API_KEY` not set, or Resend domain not verified (SPF/DKIM)                               |
| Publish succeeds but site unchanged      | `GITHUB_DISPATCH_TOKEN` missing, or the snapshot has no published speakers/sessions              |
| Deploy fails with "Authentication error" | `CLOUDFLARE_API_TOKEN` missing Pages:Edit permission                                             |
