/**
 * §27.5 — assert the built public-web output contains no noindex meta tag.
 * Guards against accidentally inheriting admin-web's metadata defaults.
 * Exempts 404/_not-found pages — Next.js adds noindex to those by design.
 * Usage: node scripts/assert-no-noindex.mjs <assets-dir>
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] ?? "apps/public-web/.open-next/assets";
const EXEMPT = new Set(["404.html", "_not-found.html"]);
let violations = 0;

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full);
    else if (entry.endsWith(".html") && !EXEMPT.has(entry)) {
      const html = readFileSync(full, "utf-8");
      if (/<meta[^>]+name=["']robots["'][^>]*noindex/i.test(html)) {
        console.error(`[assert-no-noindex] VIOLATION: ${full} contains noindex`);
        violations++;
      }
    }
  }
}

walk(root);
if (violations > 0) {
  console.error(`[assert-no-noindex] ${violations} violation(s) found`);
  process.exit(1);
}
console.log("[assert-no-noindex] OK — no noindex in public-web output");
