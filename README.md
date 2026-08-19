# PG Day Egypt 2026

Official website for **PG Day Egypt 2026** — Egypt's first PostgreSQL community
conference. Saturday, October 10, 2026 · Cairo, Egypt (venue TBA).

Built with Next.js (App Router), deployed to Cloudflare Workers via
[OpenNext](https://opennext.js.org/cloudflare), styled with Tailwind CSS v4.

## ⚠ Placeholder content

**All speaker names, companies, bios, sponsor names/logos, and organizer names
in `/content` are dummy placeholder data for development.** They are realistic
in style and drawn from real categories of companies with a Cairo/Egypt tech
presence, but the specific people are fictional, and no company listed has
confirmed sponsorship.

Replace everything under `/content` with real, confirmed data before public
launch. See `/content/README.md`.

## Tech stack

| Layer      | Choice                                                 |
| ---------- | ------------------------------------------------------ |
| Framework  | Next.js 16 (App Router)                                |
| Deploy     | Cloudflare Workers via `@opennextjs/cloudflare`        |
| Styling    | Tailwind CSS v4 (design tokens in `app/globals.css`)   |
| Content    | Static JSON in `/content`                              |
| Database   | Cloudflare D1 (`registrations` + `rate_limits` tables) |
| Email      | Resend (registration thank-you)                        |
| Validation | Zod (shared client/server schema)                      |

## Getting started

```bash
npm install
npm run dev            # local dev server
```

Requirements: Node 22+.

## Database setup (D1)

```bash
# one-time: create the remote database and put its id in wrangler.jsonc
npm run db:create

# run migrations locally (for `next dev` + local API testing)
npm run db:migrate:local

# run migrations against the remote database
npm run db:migrate:remote
```

## Environment variables

Copy `.dev.vars.example` to `.dev.vars` for local development:

| Var              | Purpose                                             |
| ---------------- | --------------------------------------------------- |
| `RESEND_API_KEY` | Resend API key for the registration thank-you email |
| `EMAIL_FROM`     | Verified "from" address on Resend                   |
| `SITE_URL`       | Public URL used in emails/metadata                  |

The API route treats email as best-effort: if `RESEND_API_KEY` is missing or
sending fails, registration still succeeds (and logs the error).

## Build & deploy

```bash
npm run typecheck     # tsc --noEmit
npm run lint          # eslint .
npm run format:check  # prettier --check .

npm run build         # Next.js production build
npm run preview       # OpenNext local preview (Cloudflare runtime)
npm run deploy        # build + deploy to Cloudflare Workers
```

## Feature flags (`content/site-config.json`)

- `features.showSponsors` — hides the Sponsors nav link, homepage strip, and
  `/sponsors` route with a single boolean.
- `features.showCountdown` — homepage countdown badge.
- `registration.open` — `false` replaces the register form with a closed message.
- Individual sponsors have their own `visible` flag in `content/sponsors.json`.

## Registration flow

Submissions to `/register` are stored with `status = "pending"`. Organizers
review and confirm attendance manually — outside this v1 site — via:

```bash
npm run db:query:remote -- "--command=SELECT id, name, email, status, created_at FROM registrations ORDER BY created_at"
npm run db:query:remote -- "--command=UPDATE registrations SET status='confirmed' WHERE id='...'"
```

`status` values: `pending | confirmed | waitlisted | declined`.

## Project structure

```
app/                 pages + API route (App Router)
components/          UI, layout, schedule, speakers, sponsors, register
content/             all editable content (JSON) — see content/README.md
lib/                 config loader, zod schemas, D1 + Resend helpers
migrations/          D1 migrations
public/images/       speaker + sponsor assets (placeholders — replace before launch)
```
