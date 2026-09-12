/**
 * @pgegypt/auth tests — RBAC matrix, permission normalization, password hash,
 * session token + cookie helpers. Pure unit tests, no I/O.
 */
import { describe, it, expect } from "vitest";
import {
  hasPermission,
  normalizePermissionRow,
  allPermissionsForSuperAdmin,
  permissionsFromRows,
  hashPassword,
  verifyPassword,
  generateSessionToken,
  hashToken,
  hashTokenSync,
  buildSessionCookie,
  parseSessionToken,
  sessionCookieOptions,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from "../src/index.js";

describe("RBAC — hasPermission (§14)", () => {
  it("SUPER_ADMIN passes everything", () => {
    expect(hasPermission("SUPER_ADMIN", [], "users:READ")).toBe(true);
    expect(hasPermission("SUPER_ADMIN", [], "publishing:WRITE")).toBe(true);
  });

  it("ADMIN requires explicit permission; WRITE implies READ", () => {
    expect(hasPermission("ADMIN", [], "speakers:READ")).toBe(false);
    expect(hasPermission("ADMIN", ["speakers:READ"], "speakers:READ")).toBe(true);
    expect(hasPermission("ADMIN", ["speakers:WRITE"], "speakers:READ")).toBe(true);
    expect(hasPermission("ADMIN", ["speakers:WRITE"], "speakers:WRITE")).toBe(true);
    expect(hasPermission("ADMIN", ["speakers:READ"], "speakers:WRITE")).toBe(false);
    expect(hasPermission("ADMIN", ["speakers:WRITE"], "registrations:READ")).toBe(false);
  });
});

describe("RBAC — permission normalization (§14)", () => {
  it("normalizePermissionRow enforces WRITE→READ and validates module", () => {
    expect(normalizePermissionRow({ module: "cfp", canWrite: 1 })).toEqual({
      module: "cfp",
      canRead: 1,
      canWrite: 1,
    });
    expect(normalizePermissionRow({ module: "cfp", canRead: 1, canWrite: 0 })).toEqual({
      module: "cfp",
      canRead: 1,
      canWrite: 0,
    });
    expect(normalizePermissionRow({ module: "cfp", canRead: 0, canWrite: 0 })).toEqual({
      module: "cfp",
      canRead: 0,
      canWrite: 0,
    });
    expect(() => normalizePermissionRow({ module: "nope", canRead: 1 })).toThrow(/Invalid module/);
  });

  it("allPermissionsForSuperAdmin covers all modules READ+WRITE", () => {
    const perms = allPermissionsForSuperAdmin();
    expect(perms).toHaveLength(9 * 2);
    expect(perms).toContain("events:READ");
    expect(perms).toContain("publishing:WRITE");
  });

  it("permissionsFromRows maps rows to Permission strings", () => {
    const rows = [
      { module: "sessions", canRead: 1, canWrite: 1 },
      { module: "media", canRead: 1, canWrite: 0 },
      { module: "users", canRead: 0, canWrite: 0 },
    ];
    expect(permissionsFromRows(rows)).toEqual(["sessions:READ", "sessions:WRITE", "media:READ"]);
  });
});

describe("Password hashing (§14.2)", () => {
  it("hashPassword produces a verifiable hash; wrong password rejected", async () => {
    const hash = await hashPassword("SuperSecret123!");
    expect(hash).toBeTruthy();
    expect(hash).not.toContain("SuperSecret123!");
    expect(await verifyPassword("SuperSecret123!", hash)).toBe(true);
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("distinct passwords produce distinct hashes", async () => {
    const h1 = await hashPassword("password-one");
    const h2 = await hashPassword("password-two");
    expect(h1).not.toBe(h2);
  });
});

describe("Session tokens + cookies (§14.3)", () => {
  it("generateSessionToken returns opaque high-entropy token", () => {
    const t1 = generateSessionToken();
    const t2 = generateSessionToken();
    expect(t1).toMatch(/^[0-9a-f]{64}$/);
    expect(t1).not.toBe(t2);
  });

  it("hashToken is deterministic and not reversible", async () => {
    const token = generateSessionToken();
    const h1 = await hashToken(token);
    const h2 = await hashToken(token);
    expect(h1).toBe(h2);
    expect(h1).not.toBe(token);
    expect(hashTokenSync(token)).toBe(h1);
  });

  it("buildSessionCookie + parseSessionToken round-trip", () => {
    const token = generateSessionToken();
    const cookie = buildSessionCookie(token, { secure: true, sameSite: "Lax" });
    expect(cookie).toContain(`${SESSION_COOKIE}=${token}`);
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(parseSessionToken(cookie)).toBe(token);
    expect(parseSessionToken(null)).toBeNull();
    expect(parseSessionToken("")).toBeNull();
    expect(parseSessionToken("other=abc")).toBeNull();
  });

  it("sessionCookieOptions defaults: 7-day TTL, Lax, no Secure in dev", () => {
    const opts = sessionCookieOptions({ secure: false });
    expect(opts.maxAge).toBe(SESSION_TTL_SECONDS);
    expect(opts.sameSite).toBe("Lax");
    expect(opts.secure).toBe(false);
    const prod = sessionCookieOptions({ secure: true });
    expect(prod.secure).toBe(true);
  });
});
