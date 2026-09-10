# PG Day Egypt 2026

Official platform for **PG Day Egypt 2026** — Egypt's first PostgreSQL community
conference. Saturday, October 10, 2026 · Cairo, Egypt (venue TBA).

A pnpm + Turborepo monorepo with three apps:

| App               | What                                                   | Local   |
| ----------------- | ------------------------------------------------------ | ------- |
| `apps/public-web` | Public website (Next.js, static-first)                 | `:3000` |
| `apps/admin-web`  | Organizer panel (Next.js, private)                     | `:3001` |
| `apps/api`        | API + auth + CFP + check-in (Hono, plain Node locally) | `:8787` |

Public pages never touch the database at request time — content is published
from the admin panel into static JSON, then built. See `docs/deployment.md`
for the Cloudflare deploy path (Workers + D1 + R2 + Queues).

## ⚠ Placeholder content

**All speaker names, companies, bios, sponsor names/logos, and organizer names
in `apps/public-web/content` are dummy placeholder data for development.** They
are realistic in style and drawn from real categories of companies with a
Cairo/Egypt tech presence, but the specific people are fictional, and no company
listed has confirmed sponsorship.

Replace everything under `apps/public-web/content` with real, confirmed data
before public launch.

## Tech stack

| Layer      | Choice                                                        |
| ---------- | ------------------------------------------------------------- |
| Framework  | Next.js 16 (App Router)                                       |
| Deploy     | Cloudflare Workers via `@opennextjs/cloudflare` (Phase 7)     |
| Styling    | Tailwind CSS v4 (design tokens in `packages/ui`)              |
| Content    | Static JSON in `apps/public-web/content` (written by Publish) |
| Database   | SQLite file locally · Cloudflare D1 in prod (Drizzle ORM)     |
| Email      | Maildev locally · Resend in prod (best-effort, queued)        |
| Storage    | MinIO locally · R2 in prod (S3-compatible)                    |
| Validation | Zod (shared client/server schemas in `packages/validation`)   |

## Getting started (Monorepo local dev — Docker + pnpm)

Requirements: Node 22+, pnpm 9+, Docker.

```bash
# Install deps
pnpm install

# Start local infra (MinIO + Maildev) — no Cloudflare bindings needed locally
docker compose up -d          # MinIO :9000/:9001 (minioadmin/minioadmin), Maildev :1025/:1080
pnpm db:migrate                 # migrates packages/db/data/local.db (Drizzle sqlite-core)
pnpm db:seed                   # seeds default event + demo data

# Run all 3 apps (local-first: SQLite file, MinIO, in-process queue, Maildev)
pnpm dev                       # api :8787, public-web :3000, admin-web :3001 (proxy /api → api)
# Or individually
pnpm dev:api
pnpm dev:public
pnpm dev:admin

# Single-command CI check (lint + typecheck + test + build + secrets + Playwright)
pnpm ci:local                  # or bash scripts/ci-local.sh [--skip-e2e] [--skip-build]
```

Local dev never uses `wrangler dev` — plain Node + SQLite file per Phases 0-6.

## Database

Migrations live in `migrations/` (SQLite dialect — same files run locally and
on D1). Local file: `packages/db/data/local.db` (gitignored).

```bash
pnpm db:migrate   # apply pending migrations to the local file
pnpm db:seed      # seed default event + demo content
```

Remote D1 databases are migrated only from CI (`deploy-api.yml` runs
`wrangler d1 migrations apply` behind staging/production environments).

## Environment variables

Copy `.env.example` to `.env.local` as needed for local development. All
values in `.env.example` are local-only defaults (MinIO/Maildev). Production
secrets live in Cloudflare Worker secrets + GitHub Environments — never in the
repo. See `docs/deployment.md`.

Email is best-effort everywhere: if sending fails, registration/CFP/check-in
still succeed (and the failure is logged).

## Build, test & deploy

```bash
pnpm turbo run lint typecheck test build   # all apps+packages (Turbo)
pnpm test:coverage                          # vitest workspace with >=80% on critical paths
pnpm e2e                                    # API E2E (registration, CFP, RBAC, schedule conflicts, check-in, publish)
pnpm exec playwright test --project=a11y   # axe accessibility: portal + admin (needs dev servers)
pnpm lint:fix && pnpm format
pnpm build         # Next.js + api builds
```

Deploys run from GitHub Actions (`deploy-api.yml`, `deploy-public-web.yml`,
`deploy-admin-web.yml`, `backup.yml`) after Cloudflare resources + secrets are
provisioned — see `docs/deployment.md`.

## Feature flags (`apps/public-web/content/site-config.json`)

Managed in the admin panel under **Settings** (persisted to the event, applied
on the next Publish):

- `features.showSponsors` — hides the Sponsors nav link, homepage strip, and
  `/sponsors` route with a single boolean.
- `features.showCountdown` — homepage countdown badge.
- `registration.open` — `false` replaces the register form with a closed message.
- Individual sponsors have their own `visible` flag.

## Registration flow

Submissions to `/register` are stored with `status = "pending"`. Organizers
review and update statuses in the admin panel under **Registrations** (status
changes notify the attendee by email).

`status` values: `pending | confirmed | waitlisted | declined`.

## Project structure

```
apps/
  public-web/      public website (routes, components, content/*.json)
  admin-web/       organizer panel (dashboard, CRUD, CFP inbox, check-in, users, settings)
  api/             Hono API (routes, services, middleware, jobs)
packages/
  ui/ validation/ types/ config/   shared frontend + schemas
  db/ auth/ storage/ queue/ mail/ publish/  server adapters
migrations/        SQLite migrations (local file + D1)
e2e/               Playwright specs (browser) + Vitest API E2E
scripts/           ci-local.sh, content snapshot, backups, cleanup jobs
docker/            local MinIO + Maildev
docs/              deployment + runbooks
```
