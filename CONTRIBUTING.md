# Contributing to PG Day Egypt 2026

Thanks for helping build this! This guide covers how to set up your environment, what the conventions are, and how to get your changes merged.

---

## Getting started

Follow the **Quick start** in the [README](README.md). You should have:

- Node.js 22+ and pnpm 9+
- The three apps running locally (`pnpm dev`)
- Local admin accounts (`superadmin@pgegypt.test` / `SuperAdmin123!`)

If anything in the quick start doesn't work on your machine (Windows, Linux, or Mac), open an issue — that's a bug in the docs.

---

## How the project is organized

- **Three apps** in `apps/`: `public-web` (the website), `admin-web` (the organizer panel), `api` (the backend).
- **Shared packages** in `packages/`: auth, db, mail, publish, queue, storage, validation, ui, types, config.
- **One database schema** in `packages/db` + `migrations/`. The same SQL runs on SQLite locally and Cloudflare D1 in production.

**Golden rule:** the public site is static. Content lives in the database, gets published to JSON snapshots, and the site rebuilds. Never add a runtime database read to the public site.

---

## Development workflow

### 1. Pick a branch

Work on a feature branch off `master`:

```bash
git checkout master
git pull
git checkout -b feat/your-thing
```

### 2. Make your change

- **API changes** → `apps/api` + `packages/*`
- **Admin UI changes** → `apps/admin-web`
- **Public site changes** → `apps/public-web`
- **Schema changes** → add a new file in `migrations/` (e.g. `0010_your_change.sql`) and update `packages/db/src/schema.ts`

### 3. Run the checks

```bash
pnpm typecheck   # must pass
pnpm lint        # must pass
pnpm test        # must pass
pnpm e2e         # must pass
```

If you changed the schema, also run:

```bash
pnpm db:migrate  # applies your new migration locally
```

### 4. Commit

We use conventional commits:

```
feat(admin): add bulk registration actions
fix(api): correct session time conflict check
docs: update deployment guide
```

Keep commits focused. One logical change per commit.

### 5. Open a pull request

- Target `master`.
- Describe what you changed and why.
- Mention anything a reviewer should test manually (e.g. "try uploading a speaker portrait").
- CI runs automatically on the PR — it must be green before merge.

---

## Conventions

### Code style

- TypeScript everywhere, strict mode.
- Prefer small, pure functions over classes.
- No `any` unless there's a real reason — and then comment why.
- Comments explain _why_, not _what_. The code should be self-explanatory.
- No SQL jokes, no "hacker terminal" styling, no `mono-data` nerd fonts in user-facing UI. This is a professional conference site.

### API design

- JSON envelope: `{ success: true, data, requestId }` or `{ success: false, error, message, requestId }`.
- Errors use proper HTTP status codes (400, 401, 403, 404, 409, 422, 429, 500).
- Every mutation writes an audit log entry.
- Never log PII (emails, tokens). Use the redaction helpers.

### Database

- Migrations are forward-only. Never edit an applied migration — add a new one.
- Soft deletes (`deleted_at`) everywhere; hard deletes only where it makes sense (e.g. temp tables).
- The schema must stay portable between SQLite and D1. No Postgres-only syntax.

### Security

- Passwords: Argon2id via `@pgegypt/auth` (pure JS — the WASM variant breaks in Workers).
- Session tokens: opaque, stored hashed.
- Admin mutations require the `X-Requested-With: pgegypt-admin` header in production (CSRF).
- Never commit secrets. Local values go in `.env.local` (gitignored); production values go in `wrangler secret put` or GitHub Actions secrets.

---

## Testing

- **Unit/integration tests** live next to the code (`*.test.ts`). Run with `pnpm test`.
- **API e2e tests** in `e2e/`. Run with `pnpm e2e`.
- **Browser tests** (Playwright + axe) run in CI on every PR.
- When you fix a bug, add a test that would have caught it.

---

## Docs

- User-facing docs live in `docs/` and the README.
- Write for humans. Short sentences. No jargon walls.
- If you change behavior, update the relevant docs in the same PR.

---

## Questions?

Open an issue or ask in the project channel. No question is too small.
