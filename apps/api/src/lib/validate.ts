import type { Context, Next } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { ZodType } from "zod";
import type { AppEnv } from "../app.js";

/**
 * Zod validation helpers — thin wrappers over `@hono/zod-validator`
 * that return the platform's consistent error envelope:
 *   { success: false, error: "VALIDATION_ERROR", message, fieldErrors, requestId }
 *
 * Use in routes like:
 *   app.post('/v1/registrations', validateJson(RegistrationSchema), handler)
 *
 * Notes:
 * - `fieldErrors` is Record<string, string[]> aggregated from Zod issues.
 * - `message` is first issue or generic "Validation failed".
 * - Status is 422 for body validation, 400 for query/param.
 */

function toFieldErrors(error: {
  flatten: () => { fieldErrors: Record<string, string[]>; formErrors: string[] };
}): Record<string, string[]> {
  const flat = error.flatten();
  const out: Record<string, string[]> = { ...flat.fieldErrors };
  if (flat.formErrors.length > 0) {
    out._form = flat.formErrors;
  }
  return out;
}

function validationHook<T extends ZodType>(
  result: { success: boolean; data?: unknown; error?: unknown },
  c: Context<AppEnv>
) {
  if (!result.success) {
    const err = result.error as {
      flatten: () => { fieldErrors: Record<string, string[]>; formErrors: string[] };
      issues: Array<{ message: string }>;
    };
    const fieldErrors =
      typeof (err as unknown as { flatten?: unknown }).flatten === "function"
        ? toFieldErrors(err as never)
        : {};
    const message = err.issues?.[0]?.message ?? "Validation failed";
    // 422 is used for entity validation per api-design.md
    return (c as Context<AppEnv>).json(
      {
        success: false as const,
        error: "VALIDATION_ERROR" as const,
        message,
        fieldErrors,
        requestId:
          ((c as Context<AppEnv>).get("requestId" as never) as string | undefined) ?? undefined,
      },
      422
    );
  }
  return undefined;
}

export function validateJson<T extends ZodType>(schema: T) {
  return zValidator("json", schema as never, validationHook as never);
}

export function validateQuery<T extends ZodType>(schema: T) {
  return zValidator("query", schema as never, (result, c: Context<AppEnv>) => {
    if (!result.success) {
      const err = result.error as {
        flatten: () => { fieldErrors: Record<string, string[]>; formErrors: string[] };
        issues: Array<{ message: string }>;
      };
      const fieldErrors =
        typeof (err as unknown as { flatten?: unknown }).flatten === "function"
          ? toFieldErrors(err as never)
          : {};
      const message = err.issues?.[0]?.message ?? "Invalid query parameters";
      return (c as Context<AppEnv>).json(
        {
          success: false as const,
          error: "VALIDATION_ERROR" as const,
          message,
          fieldErrors,
          requestId:
            ((c as Context<AppEnv>).get("requestId" as never) as string | undefined) ?? undefined,
        },
        400
      );
    }
    return undefined;
  });
}

export function validateParam<T extends ZodType>(schema: T) {
  return zValidator("param", schema as never, (result, c: Context<AppEnv>) => {
    if (!result.success) {
      const err = result.error as {
        flatten: () => { fieldErrors: Record<string, string[]>; formErrors: string[] };
        issues: Array<{ message: string }>;
      };
      const fieldErrors =
        typeof (err as unknown as { flatten?: unknown }).flatten === "function"
          ? toFieldErrors(err as never)
          : {};
      const message = err.issues?.[0]?.message ?? "Invalid path parameters";
      return (c as Context<AppEnv>).json(
        {
          success: false as const,
          error: "VALIDATION_ERROR" as const,
          message,
          fieldErrors,
          requestId:
            ((c as Context<AppEnv>).get("requestId" as never) as string | undefined) ?? undefined,
        },
        400
      );
    }
    return undefined;
  });
}

// Re-export for call sites that need raw zValidator
export { zValidator };
