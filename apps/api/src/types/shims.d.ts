/* eslint-disable @typescript-eslint/no-explicit-any, no-var -- ambient shims are inherently untyped by design */
/**
 * Minimal ambient declarations for hono ecosystem and others to keep `tsc --noEmit`
 * green before `pnpm install` brings real types. When real types are installed,
 * these are used as fallbacks only if module resolution cannot find real .d.ts;
 * with `skipLibCheck:true` and `moduleResolution:bundler` real types take precedence,
 * but these shims remain compatible with typed AppEnv.
 */

declare module "hono" {
  export type Env = { Variables?: Record<string, unknown>; Bindings?: Record<string, unknown> };
  export type Next = () => Promise<void>;
  export type Context<E = Env> = {
    req: {
      url: string;
      header(name: string): string | undefined;
      param(name: string): string;
      param(): Record<string, string>;
      query(name: string): string | undefined;
      query(): Record<string, string>;
      json(): Promise<unknown>;
      valid(target: string): unknown;
    };
    header(name: string, value: string): void;
    json(data: unknown, status?: number): Response;
    get<K extends string>(key: K): unknown;
    set<K extends string>(key: K, value: unknown): void;
    env: Record<string, unknown>;
    res: Response & { headers: Headers };
    status(code: number): void;
    text(data: string, status?: number): Response;
  };
  export type MiddlewareHandler<E = Env> = (c: Context<E>, next: Next) => Promise<void | Response>;
  export class Hono<E = Env> {
    constructor();
    use(path: string, ...handlers: MiddlewareHandler<E>[]): this;
    get(
      path: string,
      ...handlers: ((c: Context<E>) => unknown | Promise<unknown>)[] | MiddlewareHandler<E>[]
    ): this;
    post(
      path: string,
      ...handlers: ((c: Context<E>) => unknown | Promise<unknown>)[] | MiddlewareHandler<E>[]
    ): this;
    put(
      path: string,
      ...handlers: ((c: Context<E>) => unknown | Promise<unknown>)[] | MiddlewareHandler<E>[]
    ): this;
    patch(
      path: string,
      ...handlers: ((c: Context<E>) => unknown | Promise<unknown>)[] | MiddlewareHandler<E>[]
    ): this;
    delete(
      path: string,
      ...handlers: ((c: Context<E>) => unknown | Promise<unknown>)[] | MiddlewareHandler<E>[]
    ): this;
    route(path: string, app: Hono<unknown>): this;
    notFound(handler: (c: Context<E>) => unknown): this;
    onError(handler: (err: Error, c: Context<E>) => Response | Promise<Response>): this;
    fetch: (req: Request, env?: unknown, ctx?: unknown) => Promise<Response>;
    request(path: string, init?: RequestInit): Promise<Response>;
  }
}

declare module "hono/cors" {
  import type { MiddlewareHandler } from "hono";
  export function cors(options?: unknown): MiddlewareHandler<unknown>;
}

declare module "hono/logger" {
  import type { MiddlewareHandler } from "hono";
  export function logger(fn?: (msg: string, ...rest: string[]) => void): MiddlewareHandler<unknown>;
}

declare module "hono/cookie" {
  import type { Context } from "hono";
  export function getCookie(c: Context<unknown>, name: string): string | undefined;
  export function setCookie(c: Context<unknown>, name: string, value: string, opts?: unknown): void;
  export function deleteCookie(c: Context<unknown>, name: string, opts?: unknown): void;
}

declare module "hono/http-exception" {
  export class HTTPException extends Error {
    status: number;
    constructor(status: number, opts?: { message?: string });
  }
}

declare module "@hono/node-server" {
  export function serve(
    opts: { fetch: (req: Request) => Promise<Response>; port?: number; hostname?: string },
    listeningListener?: (info: { port: number }) => void
  ): unknown;
}

declare module "@hono/zod-validator" {
  import type { Context, Next } from "hono";
  export function zValidator(
    target: "json" | "query" | "param" | "header" | "cookie" | "form",
    schema: unknown,
    hook?: (
      result: { success: boolean; data?: unknown; error?: unknown },
      c: Context<unknown>
    ) => unknown
  ): (c: Context<unknown>, next: Next) => Promise<void | Response>;
}

declare module "better-sqlite3" {
  const Database: any;
  export = Database;
}

declare module "nodemailer" {
  const nodemailer: any;
  export = nodemailer;
}

declare interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}
declare var ExecutionContext: any;

declare module "vitest" {
  export const describe: (name: string, fn: () => void) => void;
  export const it: (name: string, fn: () => unknown) => void;
  export const test: (name: string, fn: () => unknown) => void;
  export const expect: unknown;
  export const beforeEach: (fn: () => void) => void;
  export const afterEach: (fn: () => void) => void;
}
declare module "vitest/config" {
  export function defineConfig(config: unknown): unknown;
}
