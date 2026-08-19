# Content — edit here, never in components

Everything on the site that an organizer might need to change lives in this
folder as JSON. Content is loaded at build time and never hardcoded in
components.

| File               | What it controls                                                                                                           |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `site-config.json` | Event facts (date, city, venue status), feature flags (`showSponsors`, `showCountdown`), registration status, social links |
| `speakers.json`    | Speaker profiles shown on `/speakers` and linked from `/schedule`                                                          |
| `schedule.json`    | The full single-track agenda on `/schedule`                                                                                |
| `sponsors.json`    | Sponsor tiers, logos, and links on `/sponsors` and the homepage strip                                                      |
| `organizers.json`  | The team grid on `/organizers`                                                                                             |
| `faq.json`         | Q&A pairs on `/faq`                                                                                                        |

To change anything, edit the JSON, open a PR, and redeploy. No component code
changes required.

## Feature flags

- **`features.showSponsors`** — flip to `false` to hide the Sponsors nav link,
  the homepage sponsor strip, and the `/sponsors` route entirely.
- **`features.showCountdown`** — flips the homepage countdown badge.
- **`registration.open`** — flip to `false` to replace the registration form
  with the configured `registration.closedMessage`.
- Individual sponsors have their own `visible` flag in `sponsors.json`.

## ⚠ Placeholder data

**All names, companies, bios, quotes, and logos in these files are dummy
placeholder content for development.** They are realistic in style and drawn
from real categories of companies with a Cairo/Egypt tech presence, but the
specific people are fictional, and the sponsor names are stand-ins only —
**no company listed here has confirmed sponsorship**.

Replace everything in this folder with real, confirmed data before the public
launch.
