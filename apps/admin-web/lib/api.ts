/**
 * lib/api.ts — thin HTTP client for admin-web → API.
 * All data flows through API; no direct DB imports (§8 constraint).
 *
 * Static (Pages) architecture: calls the API cross-origin directly with a
 * bearer token (no cookie, no server-side proxy). Token lives in
 * sessionStorage; 401 clears it and redirects to /login.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787";

const TOKEN_KEY = "pgegypt_admin_token";

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(TOKEN_KEY);
}

export function setAccessToken(token: string): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearAccessToken(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(TOKEN_KEY);
}

export type ApiSuccess<T> = {
  success: true;
  data: T;
  requestId?: string;
};

export type ApiFailure = {
  success: false;
  error: string;
  message: string;
  fieldErrors?: Record<string, string>;
  requestId?: string;
};

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

export type AuthUser = {
  id: string;
  email: string;
  displayName?: string;
  role: "SUPER_ADMIN" | "ADMIN";
  permissions: string[];
};

export type MeResponse = {
  user: AuthUser;
};

export type LoginPayload = {
  email: string;
  password: string;
};

export type LoginResponse = {
  user: AuthUser;
  expiresAt: number;
};

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fieldErrors?: Record<string, string>
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

/**
 * Core fetch helper — calls the API directly (cross-origin) with a bearer
 * token. Path must include leading slash and be relative to /v1
 * (e.g. "/auth/me" → {API_BASE}/v1/auth/me).
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = `${API_BASE}/v1${path.startsWith("/") ? path : `/${path}`}`;

  const token = getAccessToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    // §30.2 CSRF defense-in-depth — required by api on admin mutations in production
    "X-Requested-With": "pgegypt-admin",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init.headers as Record<string, string> | undefined),
  };

  const res = await fetch(url, {
    ...init,
    headers,
  });

  // Handle 204 No Content
  if (res.status === 204) {
    return undefined as T;
  }

  let body: unknown = null;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    body = await res.json().catch(() => null);
  } else {
    const text = await res.text().catch(() => "");
    body = text ? { message: text } : null;
  }

  if (!res.ok) {
    const err = body as Partial<ApiFailure> | null;
    const code = (err?.error as string) ?? `HTTP_${res.status}`;
    const message = (err?.message as string) ?? res.statusText ?? "Request failed";
    const fieldErrors = (err?.fieldErrors as Record<string, string> | undefined) ?? undefined;

    // §14.3 — session expired/revoked: clear token and send the organizer back
    // to login once. Skip for the login endpoint itself so the form can show
    // the real error.
    if (res.status === 401 && typeof window !== "undefined" && !path.includes("/auth/login")) {
      clearAccessToken();
      const next = window.location.pathname + window.location.search;
      if (!window.location.pathname.startsWith("/login")) {
        window.location.assign(`/login?next=${encodeURIComponent(next)}`);
      }
    }

    throw new ApiClientError(res.status, code, message, fieldErrors);
  }

  // API envelope is { success, data, requestId } — unwrap data for callers that expect it,
  // but return full body so callers can choose.
  // For convenience, return body as T — callers typing ApiSuccess<T> get data correctly.
  return body as T;
}

/** Shorthand: GET and unwrap ApiSuccess.data */
export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch<ApiSuccess<T>>(path, { ...init, method: "GET" });
  return res.data;
}

/** Shorthand: POST JSON */
export async function apiPost<T>(path: string, body: unknown, init?: RequestInit): Promise<T> {
  const res = await apiFetch<ApiSuccess<T>>(path, {
    ...init,
    method: "POST",
    body: JSON.stringify(body),
  });
  return res.data;
}

/**
 * Auth helpers — thin wrappers around /auth endpoints.
 * Login returns a bearer token (stored in sessionStorage by the login page).
 */
export function login(payload: LoginPayload): Promise<LoginResponse & { accessToken: string }> {
  return apiPost<LoginResponse & { accessToken: string }>("/auth/login", payload);
}

export function fetchMe(): Promise<MeResponse> {
  return apiFetch<ApiSuccess<MeResponse>>("/auth/me", { method: "GET" }).then((r) => r.data);
}

export function logout(): Promise<void> {
  return apiFetch("/auth/logout", { method: "POST" }).then(() => undefined);
}
