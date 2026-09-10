/**
 * bootstrap-ci.ts — create the two organizer accounts used by Playwright E2E in CI.
 * Run after `pnpm migrate` + `pnpm seed`:
 *   pnpm --filter @pgegypt/db exec tsx scripts/bootstrap-ci.ts
 */
import Database from "better-sqlite3";
import { hashPassword } from "../../auth/src/hash";

const dbFile = process.env.DB_FILE ?? "data/local.db";
const db = new Database(dbFile);
const now = Math.floor(Date.now() / 1000);

const superHash = await hashPassword("SuperAdmin123!");
db.prepare(
  `INSERT OR REPLACE INTO users (id, email, password_hash, display_name, role, status, created_at, updated_at)
   VALUES (?,?,?,?,?,?,?,?)`
).run(
  "user_super_001",
  "superadmin@pgegypt.test",
  superHash,
  "Super Admin",
  "SUPER_ADMIN",
  "active",
  now,
  now
);

const adminHash = await hashPassword("Admin123!");
db.prepare(
  `INSERT OR REPLACE INTO users (id, email, password_hash, display_name, role, status, created_at, updated_at)
   VALUES (?,?,?,?,?,?,?,?)`
).run("user_admin_001", "admin@pgegypt.test", adminHash, "Admin", "ADMIN", "active", now, now);

const grants: Array<[string, number, number]> = [
  ["speakers", 1, 1],
  ["sessions", 1, 1],
  ["sponsors", 1, 1],
  ["cfp", 1, 1],
  ["registrations", 1, 1],
  ["media", 1, 1],
  ["publishing", 1, 0],
];
db.prepare("DELETE FROM admin_permissions WHERE user_id='user_admin_001'").run();
const ins = db.prepare(
  "INSERT OR REPLACE INTO admin_permissions (id, user_id, module, can_read, can_write, created_at, updated_at) VALUES (?,?,?,?,?,?,?)"
);
for (const [module, canRead, canWrite] of grants) {
  ins.run(`perm_${module}_admin`, "user_admin_001", module, canRead, canWrite, now, now);
}

console.log("[bootstrap-ci] created superadmin@pgegypt.test and admin@pgegypt.test");
db.close();
