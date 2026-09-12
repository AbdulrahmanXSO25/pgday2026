/**
 * session.ts — opaque session tokens, hashing, expiry, cookie helpers.
 * Node+Workers parity: pure-JS SHA-256 via @noble/hashes (no node:crypto —
 * createRequire/node:crypto throws in the Workers runtime, which silently
 * broke bearer-token auth in prod).
 * Pure functions, explicit errors, no PII logging.
 */
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

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
    // Last-resort fallback (crypto.getRandomValues exists in Node + Workers)
    for (let i = 0; i < 32; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * SHA-256 hex of token — stored as token_hash (unique).
 * Pure JS via @noble/hashes — works in Node AND Workers (node:crypto via
 * createRequire throws in workerd).
 */
export function hashTokenSync(token: string): string {
  if (!token) throw new Error("hashTokenSync: token required");
  return bytesToHex(sha256(new TextEncoder().encode(token)));
}

/**
 * Async SHA-256 hex — same result as hashTokenSync (kept for API symmetry).
 */
export async function hashToken(token: string): Promise<string> {
  return hashTokenSync(token);
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
