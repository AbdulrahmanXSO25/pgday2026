/**
 * Structured logger with PII redaction — used by middleware and services.
 * - Every log line is JSON: { level, msg, requestId, ...fields, ts }
 * - Secrets never logged (redacts known secret keys)
 * - PII redaction: email, phone, token, password, ip partially masked
 * Pure helpers, no global state.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const SECRET_KEYS = new Set([
  "api_key",
  "apikey",
  "resend_api_key",
  "secret",
  "password",
  "token",
  "authorization",
  "cookie",
  "session",
  "hash",
]);

const PII_KEYS = new Set(["email", "to", "recipient", "phone", "ip", "client_ip"]);

function redactValue(key: string, value: unknown): unknown {
  const lower = key.toLowerCase();
  if (
    SECRET_KEYS.has(lower) ||
    lower.includes("secret") ||
    lower.includes("password") ||
    lower.includes("api_key")
  ) {
    return "***REDACTED***";
  }
  if (PII_KEYS.has(lower) || lower.endsWith("email")) {
    if (typeof value === "string") return redactEmail(value);
    return "***REDACTED***";
  }
  if (lower === "authorization" || lower === "cookie") return "***REDACTED***";
  if (typeof value === "string" && value.length > 500) {
    return value.slice(0, 500) + "…[truncated]";
  }
  return value;
}

export function redactEmail(email: string): string {
  if (typeof email !== "string" || !email.includes("@")) return "***";
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  const masked = local.length <= 2 ? "***" : `${local[0]}***${local[local.length - 1]}`;
  return `${masked}@${domain}`;
}

function redactFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      out[k] = redactFields(v as Record<string, unknown>);
    } else {
      out[k] = redactValue(k, v);
    }
  }
  return out;
}

export function formatLogLine(
  level: LogLevel,
  msg: string,
  fields: Record<string, unknown> = {}
): string {
  const redacted = redactFields(fields);
  const line = {
    level,
    msg,
    ts: new Date().toISOString(),
    ...redacted,
  };
  return JSON.stringify(line);
}

// Factory — DI-friendly logger bound to requestId
export type Logger = {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
};

export function createLogger(
  requestId: string,
  enabledLevels: LogLevel[] = ["info", "warn", "error"]
): Logger {
  const enabled = new Set(enabledLevels);
  const emit = (level: LogLevel, msg: string, fields: Record<string, unknown> = {}) => {
    if (!enabled.has(level) && level !== "error") return;
    const line = formatLogLine(level, msg, { requestId, ...fields });
    const fn =
      level === "error"
        ? console.error
        : level === "warn"
          ? console.warn
          : level === "debug"
            ? console.debug
            : console.log;
    fn(line);
  };

  return {
    debug: (msg, fields) => emit("debug", msg, fields),
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
  };
}

// Static helper for non-request contexts (e.g. queue consumer startup)
export const logger = {
  info: (msg: string, fields: Record<string, unknown> = {}) =>
    console.log(formatLogLine("info", msg, fields)),
  warn: (msg: string, fields: Record<string, unknown> = {}) =>
    console.warn(formatLogLine("warn", msg, fields)),
  error: (msg: string, fields: Record<string, unknown> = {}) =>
    console.error(formatLogLine("error", msg, fields)),
  debug: (msg: string, fields: Record<string, unknown> = {}) =>
    console.debug(formatLogLine("debug", msg, fields)),
};
