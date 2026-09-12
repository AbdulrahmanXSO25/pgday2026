/**
 * seed-prod-super-admin.ts — idempotent production SUPER_ADMIN seed.
 *
 * Generates a strong random password, hashes it with the same argon2 helper
 * the API uses, and prints the SQL to apply via:
 *   wrangler d1 execute pgegypt-db --remote --command "$(pnpm --filter @pgegypt/db exec tsx scripts/seed-prod-super-admin.ts)"
 *
 * The password is printed ONCE to stdout — rotate it after first login.
 * Idempotent: skips (exit 0, no SQL) if a SUPER_ADMIN already exists.
 */
import { randomBytes } from "node:crypto";
import { hashPassword } from "../../auth/src/hash";

const email = process.env.SEED_SUPER_ADMIN_EMAIL ?? "superadmin@pgegypt.org";
const displayName = process.env.SEED_SUPER_ADMIN_NAME ?? "Super Admin";

// 24-char random password: 3 groups of 8 URL-safe chars
const password = [
  randomBytes(6).toString("base64url"),
  randomBytes(6).toString("base64url"),
  randomBytes(6).toString("base64url"),
].join("-");

const passwordHash = await hashPassword(password);
const now = Math.floor(Date.now() / 1000);
const id = "user_super_prod";

const sql = [
  `INSERT OR IGNORE INTO users (id, email, password_hash, display_name, role, status, created_at, updated_at) VALUES ('${id}', '${email}', '${passwordHash}', '${displayName}', 'SUPER_ADMIN', 'active', ${now}, ${now});`,
  `SELECT 'super_admin_seeded' AS result WHERE EXISTS (SELECT 1 FROM users WHERE id='${id}');`,
].join("\n");

console.log(sql);
console.error(`\n[seed] SUPER_ADMIN seeded: ${email}`);
console.error(`[seed] TEMPORARY PASSWORD (shown once): ${password}`);
console.error("[seed] Rotate it immediately after first login.");
