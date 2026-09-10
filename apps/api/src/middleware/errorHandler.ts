import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../app.js";

/**
 * Consistent API error envelope.
 * Shape aligns with @pgegypt/types ApiError but extended with `error` code.
 *
 * Success: { success: true, data: ... }
 * Error:   { success: false, error: "CODE", message: string, fieldErrors?: Record<string,string[]>, requestId?: string }
 */

export type ErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "NOT_IMPLEMENTED"
  | "INTERNAL_ERROR";

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly fieldErrors?: Record<string, string[]>;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    fieldErrors?: Record<string, string[]>
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

// Factory helpers — small pure functions, no side effects
export const notImplemented = (message = "Not implemented") =>
  new ApiError(501, "NOT_IMPLEMENTED", message);

export const notFound = (message = "Not Found") => new ApiError(404, "NOT_FOUND", message);
export const badRequest = (message: string, fieldErrors?: Record<string, string[]>) =>
  new ApiError(400, "BAD_REQUEST", message, fieldErrors);
export const validationError = (message: string, fieldErrors?: Record<string, string[]>) =>
  new ApiError(422, "VALIDATION_ERROR", message, fieldErrors);
export const unauthorized = (message = "Authentication required") =>
  new ApiError(401, "UNAUTHORIZED", message);
export const forbidden = (message = "Forbidden") => new ApiError(403, "FORBIDDEN", message);
export const conflict = (message: string) => new ApiError(409, "CONFLICT", message);
export const rateLimited = (message = "Too many requests") =>
  new ApiError(429, "RATE_LIMITED", message);

function isProd(c: Context<AppEnv>): boolean {
  // Check Bindings.RUNTIME (Workers) then process.env.RUNTIME / NODE_ENV
  const runtime =
    (c.env as { RUNTIME?: string } | undefined)?.RUNTIME ??
    (typeof process !== "undefined" ? (process.env.RUNTIME ?? process.env.NODE_ENV) : undefined);
  return runtime === "production" || runtime === "prod";
}

/**
 * Central onError handler for Hono — must be registered via `app.onError(errorHandler)`.
 * - Normalizes ApiError, HTTPException, ZodError, and generic Errors into envelope.
 * - Does NOT leak stack in prod (RUNTIME=production).
 * - Always includes X-Request-Id header (set by requestIdMiddleware).
 */
export function errorHandler(err: Error, c: Context<AppEnv>): Response {
  const requestId = (() => {
    try {
      const id = c.get("requestId" as never) as string | undefined;
      return id ?? "unknown";
    } catch {
      return "unknown";
    }
  })();

  // Ensure X-Request-Id is present even on error
  try {
    if (requestId && requestId !== "unknown") c.header("X-Request-Id", requestId);
  } catch {
    // ignore header set errors
  }

  // Zod / validation errors thrown as ApiError with 422 are already handled
  // Also handle Hono HTTPException
  if (err instanceof HTTPException) {
    const status = err.status;
    const code = statusToCode(status);
    const message = err.message || httpStatusMessage(status);
    return c.json(
      {
        success: false as const,
        error: code,
        message,
        requestId,
      },
      status
    );
  }

  if (err instanceof ApiError) {
    const payload: Record<string, unknown> = {
      success: false,
      error: err.code,
      message: err.message,
      requestId,
    };
    if (err.fieldErrors) payload.fieldErrors = err.fieldErrors;
    // Add stack only in non-prod for debugging
    if (!isProd(c) && err.stack) {
      payload.stack = err.stack;
    }
    return c.json(payload, err.status as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 501);
  }

  // Generic unexpected error — log with requestId (redacted), return 500 without stack in prod
  const prod = isProd(c);
  const logPayload = prod
    ? `[${requestId}] internal error: ${err.name}`
    : `[${requestId}] internal error: ${err.name}: ${err.message}\n${err.stack ?? ""}`;
  // Use console.error — structured logging will replace in observability phase
  console.error(logPayload);

  const body: Record<string, unknown> = {
    success: false,
    error: "INTERNAL_ERROR" as ErrorCode,
    message: prod ? "Internal Server Error" : err.message || "Internal Server Error",
    requestId,
  };
  if (!prod && err.stack) body.stack = err.stack;

  return c.json(body, 500);
}

function statusToCode(status: number): ErrorCode {
  switch (status) {
    case 400:
      return "BAD_REQUEST";
    case 401:
      return "UNAUTHORIZED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 409:
      return "CONFLICT";
    case 429:
      return "RATE_LIMITED";
    default:
      return status >= 500 ? "INTERNAL_ERROR" : "BAD_REQUEST";
  }
}

function httpStatusMessage(status: number): string {
  switch (status) {
    case 400:
      return "Bad Request";
    case 401:
      return "Unauthorized";
    case 403:
      return "Forbidden";
    case 404:
      return "Not Found";
    case 409:
      return "Conflict";
    case 429:
      return "Too Many Requests";
    case 501:
      return "Not Implemented";
    default:
      return status >= 500 ? "Internal Server Error" : "Error";
  }
}
