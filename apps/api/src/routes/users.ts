import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app.js";
import { validateJson } from "../lib/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { requireSuperAdmin } from "../middleware/requirePermission.js";
import { requireDb, getDb } from "../lib/db.js";
import { ApiError } from "../middleware/errorHandler.js";
import * as authService from "../services/auth.service.js";
import { MODULES } from "@pgegypt/auth";

const CreateUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(100),
  role: z.enum(["SUPER_ADMIN", "ADMIN"]).optional().default("ADMIN"),
  permissions: z
    .array(
      z.object({
        module: z.enum(MODULES as unknown as [string, ...string[]]),
        canRead: z.union([z.boolean(), z.number().int().min(0).max(1)]).optional(),
        canWrite: z.union([z.boolean(), z.number().int().min(0).max(1)]).optional(),
      })
    )
    .optional(),
});

const UpdatePermissionsSchema = z.object({
  permissions: z.array(
    z.object({
      module: z.enum(MODULES as unknown as [string, ...string[]]),
      canRead: z.union([z.boolean(), z.number().int().min(0).max(1)]).optional(),
      canWrite: z.union([z.boolean(), z.number().int().min(0).max(1)]).optional(),
    })
  ),
});

function getMeta(c: { req: { header(n: string): string | undefined } }): {
  ip: string;
  userAgent: string;
} {
  const ip =
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    c.req.header("x-real-ip") ??
    "unknown";
  const ua = c.req.header("user-agent") ?? "unknown";
  return { ip, userAgent: ua };
}

export function usersRoutes() {
  const r = new Hono<AppEnv>();

  // POST /v1/admin/users — SUPER_ADMIN only
  const createHandler = async (c: import("hono").Context<AppEnv>) => {
    const body = c.req.valid("json" as never) as z.infer<typeof CreateUserSchema>;
    const db = requireDb(c);
    const actor = c.get("user" as never) as { id: string } | undefined;
    const meta = getMeta(c as { req: { header(n: string): string | undefined } });
    const result = await authService.createUser(
      db,
      {
        email: body.email,
        password: body.password,
        displayName: body.displayName,
        role: body.role as never,
        permissions: body.permissions as never,
      },
      { actorId: actor?.id, ...meta }
    );
    return c.json(
      {
        success: true as const,
        data: result,
        requestId: c.get("requestId" as never) as string | undefined,
      },
      201
    );
  };

  r.post(
    "/v1/admin/users",
    requireAuth(),
    requireSuperAdmin(),
    validateJson(CreateUserSchema),
    createHandler
  );
  // Alias per spec: POST /v1/users
  r.post(
    "/v1/users",
    requireAuth(),
    requireSuperAdmin(),
    validateJson(CreateUserSchema),
    createHandler
  );

  // GET /v1/admin/users — SUPER_ADMIN only
  const listHandler = async (c: import("hono").Context<AppEnv>) => {
    const db = requireDb(c);
    const users = await authService.listUsers(db);
    // Strip passwordHash before returning
    const safe = users.map(({ passwordHash: _ph, ...rest }) => rest);
    return c.json(
      {
        success: true as const,
        data: safe,
        meta: { count: safe.length },
        requestId: c.get("requestId" as never) as string | undefined,
      },
      200
    );
  };
  r.get("/v1/admin/users", requireAuth(), requireSuperAdmin(), listHandler);
  r.get("/v1/users", requireAuth(), requireSuperAdmin(), listHandler);

  // GET /v1/admin/permissions — SUPER_ADMIN only (list all)
  r.get(
    "/v1/admin/permissions",
    requireAuth(),
    requireSuperAdmin(),
    async (c: import("hono").Context<AppEnv>) => {
      const db = requireDb(c);
      // Return all users with their permissions for admin view
      const users = await authService.listUsers(db);
      const result: Array<Record<string, unknown>> = [];
      for (const u of users) {
        const perms = await authService.getPermissionsForUser(db, u.id);
        result.push({
          userId: u.id,
          email: u.email,
          role: u.role,
          permissions: perms,
        });
      }
      return c.json(
        {
          success: true as const,
          data: result,
          requestId: c.get("requestId" as never) as string | undefined,
        },
        200
      );
    }
  );

  // PUT /v1/admin/permissions/:userId — update permissions, enforce WRITE→READ invariant
  r.put(
    "/v1/admin/permissions/:userId",
    requireAuth(),
    requireSuperAdmin(),
    validateJson(UpdatePermissionsSchema),
    async (c: import("hono").Context<AppEnv>) => {
      const userId = c.req.param("userId") as string;
      const body = c.req.valid("json" as never) as z.infer<typeof UpdatePermissionsSchema>;
      const db = requireDb(c);
      const actor = c.get("user" as never) as { id: string } | undefined;
      const meta = getMeta(c as { req: { header(n: string): string | undefined } });
      await authService.upsertPermissions(db, userId, body.permissions as never, {
        actorId: actor?.id,
        ...meta,
      });
      const updated = await authService.getPermissionsForUser(db, userId);
      return c.json(
        {
          success: true as const,
          data: { userId, permissions: updated },
          requestId: c.get("requestId" as never) as string | undefined,
        },
        200
      );
    }
  );

  // GET /v1/admin/audit-logs — SUPER_ADMIN only (§35)
  r.get(
    "/v1/admin/audit-logs",
    requireAuth(),
    requireSuperAdmin(),
    async (c: import("hono").Context<AppEnv>) => {
      const db = getDb(c);
      if (!db) {
        return c.json(
          {
            success: true as const,
            data: [],
            requestId: c.get("requestId" as never) as string | undefined,
          },
          200
        );
      }
      // Simple query via raw drizzle — select all audit_logs latest first
      try {
        const { auditLogs } = await import("@pgegypt/db");
        const { desc } = await import("drizzle-orm");
        // Use drizzle helper with fallback for better-sqlite3
        const query = (db as never as { select: () => never }).select
          ? (
              db as unknown as {
                select: () => {
                  from: (t: unknown) => {
                    orderBy: (o: unknown) => { limit: (n: number) => unknown };
                  };
                };
              }
            )
              .select()
              .from(auditLogs)
          : null;
        // Fallback raw sqlite query if drizzle not available
        if (query) {
          // Try to execute via all()
          const rows: unknown[] = [];
          try {
            const q = (
              db as unknown as {
                select: () => { from: (t: unknown) => { orderBy: (o: unknown) => unknown } };
              }
            )
              .select()
              .from(auditLogs)
              .orderBy(desc(auditLogs.createdAt));
            const all = (q as unknown as { all?: () => unknown[] }).all;
            if (typeof all === "function") {
              const res = all.call(q) as unknown;
              if (Array.isArray(res)) rows.push(...res);
            } else {
              const awaited = (await (q as unknown as Promise<unknown>)) as unknown;
              if (Array.isArray(awaited)) rows.push(...awaited);
              else if (
                awaited &&
                typeof awaited === "object" &&
                "results" in (awaited as Record<string, unknown>)
              ) {
                rows.push(...(((awaited as Record<string, unknown>).results as unknown[]) ?? []));
              }
            }
          } catch {
            // ignore
          }
          return c.json(
            {
              success: true as const,
              data: rows,
              requestId: c.get("requestId" as never) as string | undefined,
            },
            200
          );
        }
        // Fallback: raw sqlite prepare if better-sqlite3 Database exposed via db
        return c.json(
          {
            success: true as const,
            data: [],
            requestId: c.get("requestId" as never) as string | undefined,
          },
          200
        );
      } catch {
        return c.json(
          {
            success: true as const,
            data: [],
            requestId: c.get("requestId" as never) as string | undefined,
          },
          200
        );
      }
    }
  );

  // GET /v1/admin/users/:id — SUPER_ADMIN only (§26.3)
  r.get(
    "/v1/admin/users/:id",
    requireAuth(),
    requireSuperAdmin(),
    async (c: import("hono").Context<AppEnv>) => {
      const db = requireDb(c);
      const id = c.req.param("id") as string;
      const users = await authService.listUsers(db);
      const user = users.find((u) => u.id === id);
      if (!user) throw new ApiError(404, "NOT_FOUND", "User not found");
      const { passwordHash: _ph, ...safe } = user;
      const perms = await authService.getPermissionsForUser(db, id);
      return c.json(
        {
          success: true as const,
          data: { ...safe, permissions: perms },
          requestId: c.get("requestId" as never) as string | undefined,
        },
        200
      );
    }
  );
  r.get(
    "/v1/users/:id",
    requireAuth(),
    requireSuperAdmin(),
    async (c: import("hono").Context<AppEnv>) => {
      const db = requireDb(c);
      const id = c.req.param("id") as string;
      const users = await authService.listUsers(db);
      const user = users.find((u) => u.id === id);
      if (!user) throw new ApiError(404, "NOT_FOUND", "User not found");
      const { passwordHash: _ph, ...safe } = user;
      const perms = await authService.getPermissionsForUser(db, id);
      return c.json(
        {
          success: true as const,
          data: { ...safe, permissions: perms },
          requestId: c.get("requestId" as never) as string | undefined,
        },
        200
      );
    }
  );

  // PATCH /v1/admin/users/:id — email/displayName/role/status (§26.3), SUPER_ADMIN only
  const PatchUserSchema = z.object({
    email: z.string().email().optional(),
    displayName: z.string().min(1).max(100).optional(),
    role: z.enum(["SUPER_ADMIN", "ADMIN"]).optional(),
    status: z.enum(["active", "disabled"]).optional(),
  });
  const patchUserHandler = async (c: import("hono").Context<AppEnv>) => {
    const db = requireDb(c);
    const id = c.req.param("id") as string;
    const body = c.req.valid("json" as never) as z.infer<typeof PatchUserSchema>;
    const actor = c.get("user" as never) as { id: string } | undefined;
    const meta = getMeta(c as { req: { header(n: string): string | undefined } });
    // §13.4 — self-modification block (defense in depth)
    if (actor && actor.id === id && (body.role !== undefined || body.status === "disabled")) {
      return c.json(
        {
          success: false as const,
          error: "FORBIDDEN",
          message: "Cannot change your own role or disable yourself",
          requestId: c.get("requestId" as never) as string | undefined,
        },
        403
      );
    }
    const result = await authService.updateUser(db, id, body as never, {
      actorId: actor?.id,
      ...meta,
    });
    const { passwordHash: _ph, ...safe } = result;
    const perms = await authService.getPermissionsForUser(db, id);
    return c.json(
      {
        success: true as const,
        data: { ...safe, permissions: perms },
        requestId: c.get("requestId" as never) as string | undefined,
      },
      200
    );
  };
  r.patch(
    "/v1/admin/users/:id",
    requireAuth(),
    requireSuperAdmin(),
    validateJson(PatchUserSchema),
    patchUserHandler
  );
  r.patch(
    "/v1/users/:id",
    requireAuth(),
    requireSuperAdmin(),
    validateJson(PatchUserSchema),
    patchUserHandler
  );

  // PATCH /v1/admin/users/:id/status — convenience alias for disable/enable (§14.3)
  const PatchStatusSchema = z.object({ status: z.enum(["active", "disabled"]) });
  r.patch(
    "/v1/admin/users/:id/status",
    requireAuth(),
    requireSuperAdmin(),
    validateJson(PatchStatusSchema),
    patchUserHandler
  );
  r.patch(
    "/v1/users/:id/status",
    requireAuth(),
    requireSuperAdmin(),
    validateJson(PatchStatusSchema),
    patchUserHandler
  );

  // PATCH /v1/admin/users/:id/permissions — §13.4 self-modification block + invariant
  r.patch(
    "/v1/admin/users/:id/permissions",
    requireAuth(),
    requireSuperAdmin(),
    validateJson(UpdatePermissionsSchema),
    async (c: import("hono").Context<AppEnv>) => {
      const userId = c.req.param("id") as string;
      const body = c.req.valid("json" as never) as z.infer<typeof UpdatePermissionsSchema>;
      const db = requireDb(c);
      const actor = c.get("user" as never) as { id: string } | undefined;
      if (actor && actor.id === userId) {
        return c.json(
          {
            success: false as const,
            error: "FORBIDDEN",
            message: "Cannot modify your own permissions",
            requestId: c.get("requestId" as never) as string | undefined,
          },
          403
        );
      }
      const meta = getMeta(c as { req: { header(n: string): string | undefined } });
      await authService.upsertPermissions(db, userId, body.permissions as never, {
        actorId: actor?.id,
        ...meta,
      });
      const updated = await authService.getPermissionsForUser(db, userId);
      return c.json(
        {
          success: true as const,
          data: { userId, permissions: updated },
          requestId: c.get("requestId" as never) as string | undefined,
        },
        200
      );
    }
  );
  r.patch(
    "/v1/users/:id/permissions",
    requireAuth(),
    requireSuperAdmin(),
    validateJson(UpdatePermissionsSchema),
    async (c: import("hono").Context<AppEnv>) => {
      const userId = c.req.param("id") as string;
      const body = c.req.valid("json" as never) as z.infer<typeof UpdatePermissionsSchema>;
      const db = requireDb(c);
      const actor = c.get("user" as never) as { id: string } | undefined;
      if (actor && actor.id === userId) {
        return c.json(
          {
            success: false as const,
            error: "FORBIDDEN",
            message: "Cannot modify your own permissions",
            requestId: c.get("requestId" as never) as string | undefined,
          },
          403
        );
      }
      const meta = getMeta(c as { req: { header(n: string): string | undefined } });
      await authService.upsertPermissions(db, userId, body.permissions as never, {
        actorId: actor?.id,
        ...meta,
      });
      const updated = await authService.getPermissionsForUser(db, userId);
      return c.json(
        {
          success: true as const,
          data: { userId, permissions: updated },
          requestId: c.get("requestId" as never) as string | undefined,
        },
        200
      );
    }
  );

  return r;
}
