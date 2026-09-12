/**
 * hash.ts — Argon2id password hashing, portable across Node + Workers.
 *
 * Uses @noble/hashes (pure JS, no WASM) — hash-wasm's WebAssembly.compile()
 * is disallowed in the Workers runtime ("Wasm code generation disallowed by
 * embedder"), which silently broke password auth in prod.
 *
 * PHC string format (standard, compatible with hash-wasm output):
 *   $argon2id$v=19$m=4096,t=3,p=1$<salt-b64>$<hash-b64>
 *
 * Pure functions, explicit errors, no PII logging.
 */
import { argon2id } from "@noble/hashes/argon2";

/** Constant-time byte comparison. */
function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}

export const ARGON2_OPTS = {
  parallelism: 1,
  iterations: 3,
  memorySize: 4096, // 4MB — balanced for Workers + Node
  hashLength: 32,
} as const;

const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] as number;
    const b1 = i + 1 < bytes.length ? (bytes[i + 1] as number) : 0;
    const b2 = i + 2 < bytes.length ? (bytes[i + 2] as number) : 0;
    out += B64_ALPHABET[b0 >> 2];
    out += B64_ALPHABET[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64_ALPHABET[((b1 & 15) << 2) | (b2 >> 6)] : "=";
    out += i + 2 < bytes.length ? B64_ALPHABET[b2 & 63] : "=";
  }
  return out;
}

function fromBase64(input: string): Uint8Array {
  const clean = input.replace(/=+$/, "");
  const out = new Uint8Array(Math.floor((clean.length * 6) / 8));
  let buffer = 0;
  let bits = 0;
  let idx = 0;
  for (const ch of clean) {
    const val = B64_ALPHABET.indexOf(ch);
    if (val < 0) throw new Error("Invalid base64");
    buffer = (buffer << 6) | val;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[idx++] = (buffer >> bits) & 0xff;
    }
  }
  return out;
}

function randomSaltBytes(length = 16): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function derive(password: string, salt: Uint8Array): Uint8Array {
  return argon2id(password, salt, {
    t: ARGON2_OPTS.iterations,
    m: ARGON2_OPTS.memorySize,
    p: ARGON2_OPTS.parallelism,
    dkLen: ARGON2_OPTS.hashLength,
  });
}

/** Build PHC string: $argon2id$v=19$m=4096,t=3,p=1$<salt-b64>$<hash-b64> */
function encodePhc(salt: Uint8Array, hash: Uint8Array): string {
  return `$argon2id$v=19$m=${ARGON2_OPTS.memorySize},t=${ARGON2_OPTS.iterations},p=${ARGON2_OPTS.parallelism}$${toBase64(salt)}$${toBase64(hash)}`;
}

/** Parse PHC string → { salt, hash, m, t, p } or null if unsupported format. */
function parsePhc(encoded: string): {
  salt: Uint8Array;
  hash: Uint8Array;
  m: number;
  t: number;
  p: number;
} | null {
  const parts = encoded.split("$");
  // ["", "argon2id", "v=19", "m=4096,t=3,p=1", salt, hash]
  if (parts.length !== 6) return null;
  if (parts[1] !== "argon2id") return null;
  if (parts[2] !== "v=19") return null;
  const params = parts[3] as string;
  const m = Number(/m=(\d+)/.exec(params)?.[1]);
  const t = Number(/t=(\d+)/.exec(params)?.[1]);
  const p = Number(/p=(\d+)/.exec(params)?.[1]);
  if (!Number.isFinite(m) || !Number.isFinite(t) || !Number.isFinite(p)) return null;
  try {
    return { salt: fromBase64(parts[4] as string), hash: fromBase64(parts[5] as string), m, t, p };
  } catch {
    return null;
  }
}

export async function hashPassword(password: string): Promise<string> {
  if (!password || typeof password !== "string") {
    throw new Error("hashPassword: password must be non-empty string");
  }
  if (password.length < 8) throw new Error("hashPassword: password too short");
  if (password.length > 128) throw new Error("hashPassword: password too long");

  const salt = randomSaltBytes(16);
  const hash = derive(password, salt);
  return encodePhc(salt, hash);
}

/**
 * Verify password against encoded hash.
 * Supports argon2id PHC strings (hash-wasm + noble formats are identical).
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!password || !hash) return false;
  if (typeof password !== "string" || typeof hash !== "string") return false;

  const parsed = parsePhc(hash);
  if (!parsed) return false;

  try {
    const derived = argon2id(password, parsed.salt, {
      t: parsed.t,
      m: parsed.m,
      p: parsed.p,
      dkLen: parsed.hash.length,
    });
    return equalBytes(derived, parsed.hash);
  } catch {
    return false;
  }
}

/**
 * Sync verification helper for environments where async not desired (not used in prod).
 * Kept for symmetry — delegates to async version when available.
 */
export async function verifyPasswordSync(_password: string, _hash: string): Promise<boolean> {
  return verifyPassword(_password, _hash);
}
