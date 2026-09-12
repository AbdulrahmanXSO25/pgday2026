# PG Day Egypt 2026

The official platform for **PG Day Egypt 2026** — Egypt's first PostgreSQL community conference. Saturday, October 10, 2026 · Cairo, Egypt (venue TBA).

A pnpm + Turborepo monorepo with three apps:

| App               | What it is                         | Local URL             |
| ----------------- | ---------------------------------- | --------------------- |
| `apps/public-web` | Public website (Next.js, static)   | http://localhost:3000 |
| `apps/admin-web`  | Organizer panel (Next.js, private) | http://localhost:3001 |
| `apps/api`        | API + auth + CFP + check-in (Hono) | http://localhost:8787 |

**How content works:** the public site is static. Organizers edit content in the admin panel, hit **Publish**, and the site rebuilds from a snapshot. The public site never touches the database at request time.

---

## Quick start (local development)

**Requirements:** Node.js 22+, pnpm 9+, and Docker (optional — only for local email + file storage).

```bash
# 1. Install dependencies
pnpm install

# 2. Start local infra (MinIO for files, Maildev for email) — optional but recommended
docker compose -f docker/docker-compose.yml up -d

# 3. Create + seed the local database
pnpm db:migrate
pnpm db:seed

# 4. Create the local admin accounts
pnpm --filter @pgegypt/db exec tsx scripts/bootstrap-ci.ts

# 5. Run everything
pnpm dev
```

That's it. Open:

- **Public site** → http://localhost:3000
- **Admin panel** → http://localhost:3001
- **API health** → http://localhost:8787/v1/health
- **Maildev inbox** (emails) → http://localhost:1080
- **MinIO console** (files) → http://localhost:9001 (`minioadmin` / `minioadmin`)

### Local admin accounts

| Role        | Email                     | Password         |
| ----------- | ------------------------- | ---------------- |
| Super admin | `superadmin@pgegypt.test` | `SuperAdmin123!` |
| Admin       | `admin@pgegypt.test`      | `Admin123!`      |

### Running one app at a time

```bash
pnpm dev:api      # API only
pnpm dev:public   # public site only
pnpm dev:admin    # admin panel only
```

### Windows notes

- Use **Git Bash** or **WSL** for the shell commands above.
- If Docker isn't available, the apps still run — file uploads and email fall back to in-memory/no-op modes. The core flows (auth, CFP, registrations, check-in) work without Docker.

---

## Useful commands

| Command           | What it does                          |
| ----------------- | ------------------------------------- |
| `pnpm dev`        | Run all three apps                    |
| `pnpm test`       | Run all unit + integration tests      |
| `pnpm e2e`        | Run API e2e tests                     |
| `pnpm typecheck`  | Type-check every package              |
| `pnpm lint`       | Lint everything                       |
| `pnpm build`      | Build everything                      |
| `pnpm db:migrate` | Apply DB migrations locally           |
| `pnpm db:seed`    | Load sample content into the local DB |

---

## Tech stack

- **Monorepo:** pnpm workspaces + Turborepo
- **Public site:** Next.js 16 (static export), deployed to Cloudflare Pages
- **Admin panel:** Next.js 16 (static export), deployed to Cloudflare Pages
- **API:** Hono, deployed as a Cloudflare Worker
- **Database:** SQLite locally, Cloudflare D1 in production (same SQL)
- **Files:** MinIO locally, Cloudflare R2 in production
- **Email:** Maildev locally, Resend in production
- **Auth:** Argon2id password hashing, session tokens (cookie or bearer)
- **Tests:** Vitest + Playwright

---

## Project structure

```
apps/
  public-web/     # public website
  admin-web/      # organizer panel
  api/            # Hono API worker
packages/
  auth/           # password hashing, sessions, RBAC
  db/             # schema, migrations, seed
  mail/           # email templates + adapters
  publish/        # content snapshot + publish targets
  queue/          # email queue abstraction
  storage/        # file storage adapters (MinIO/R2)
  validation/     # Zod schemas shared across apps
  ui/             # shared UI primitives
  types/          # shared types
  config/         # shared config
migrations/       # SQL migrations (local + D1)
scripts/          # CI + ops scripts
docs/             # deployment + runbooks
```

---

## Production

- **Public site:** https://pgegypt-public-web.pages.dev
- **Admin panel:** https://pgegypt-admin-web.pages.dev
- **API:** https://pgegypt-api.abdulrahmannader-123.workers.dev

Deploys run automatically from the `master` branch via GitHub Actions. See [docs/deployment.md](docs/deployment.md) for the full picture, and [CONTRIBUTING.md](CONTRIBUTING.md) if you want to help build this.

---

## License

Private — internal project for the PostgreSQL Egypt community.
