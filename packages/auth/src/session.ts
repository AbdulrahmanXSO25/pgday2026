/**
 * session.ts — opaque session tokens, hashing, expiry, cookie helpers.
 * Node+Workers parity: uses WebCrypto when available, Node crypto fallback.
 * Pure functions, explicit errors, no PII logging.
 */
import { createRequire } from "node:module";

export const SESSION_COOKIE = "pgegypt_session" as const;
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export type SessionCookieOptions = {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none";
  path?: string;
  maxAge?: number;
  expires?: Date;
};

/**
 * Generate opaque session token — 32 random bytes hex (64 chars).
 * Uses crypto.getRandomValues (Workers + Node 22) with Node fallback.
 */
export function generateSessionToken(): string {
  const bytes = new Uint8Array(32);
  try {
    crypto.getRandomValues(bytes);
  } catch {
    try {
      const _require = createRequire(import.meta.url);
      const nodeCrypto = _require("node:crypto") as { randomBytes: (n: number) => Buffer };
      const buf = nodeCrypto.randomBytes(32);
      for (let i = 0; i < 32; i++) bytes[i] = buf[i] as number;
    } catch {
      for (let i = 0; i < 32; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * SHA-256 hex of token — stored as token_hash (unique).
 * Sync version for Node (better-sqlite3) — uses node:crypto createHash.
 */
export function hashTokenSync(token: string): string {
  if (!token) throw new Error("hashTokenSync: token required");
  try {
    const _require = createRequire(import.meta.url);
    const nodeCrypto = _require("node:crypto") as {
      createHash: (alg: string) => { update: (d: string) => { digest: (enc: string) => string } };
    };
    return nodeCrypto.createHash("sha256").update(token).digest("hex");
  } catch {
    throw new Error("hashTokenSync: node crypto unavailable — use hashToken()");
  }
}

/**
 * Async SHA-256 hex — Workers parity via SubtleCrypto.
 */
export async function hashToken(token: string): Promise<string> {
  if (!token) throw new Error("hashToken: token required");
  // Prefer sync Node path when available (fast, no subtle)
  try {
    return hashTokenSync(token);
  } catch {
    // Workers / fallback: SubtleCrypto
    const enc = new TextEncoder();
    const data = enc.encode(token);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
}

/**
 * Build Set-Cookie string for pgegypt_session.
 * httpOnly, secure, sameSite=lax per spec.
 * Caller may override secure for local http (when not prod).
 */
export function buildSessionCookie(token: string, opts: SessionCookieOptions = {}): string {
  const maxAge = opts.maxAge ?? SESSION_TTL_SECONDS;
  const expires = opts.expires ?? new Date(Date.now() + maxAge * 1000);
  const httpOnly = opts.httpOnly ?? true;
  const secure = opts.secure ?? true;
  const sameSite = opts.sameSite ?? "lax";
  const path = opts.path ?? "/";

  const parts = [`${SESSION_COOKIE}=${token}`, `Path=${path}`, `SameSite=${sameSite}`];
  if (httpOnly) parts.push("HttpOnly");
  if (secure) parts.push("Secure");
  parts.push(`Max-Age=${maxAge}`);
  parts.push(`Expires=${expires.toUTCString()}`);
  return parts.join("; ");
}

/**
 * Parse Cookie header to extract pgegypt_session value.
 */
export function parseSessionToken(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";").map((p) => p.trim());
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k === SESSION_COOKIE) {
      // strip quotes if present
      const cleaned = v.replace(/^"|"$/g, "");
      return cleaned || null;
    }
  }
  return null;
}

/**
 * Build cookie options for hono setCookie helper (object form).
 */
export function sessionCookieOptions(
  opts: {
    maxAge?: number;
    expiresAtSec?: number;
    secure?: boolean;
  } = {}
): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Lax";
  path: string;
  maxAge: number;
  expires?: Date;
} {
  const maxAge = opts.maxAge ?? SESSION_TTL_SECONDS;
  const expires = opts.expiresAtSec
    ? new Date(opts.expiresAtSec * 1000)
    : new Date(Date.now() + maxAge * 1000);
  const secure = opts.secure ?? true;
  return {
    httpOnly: true,
    secure,
    sameSite: "Lax" as const,
    path: "/",
    maxAge,
    expires,
  };
}
