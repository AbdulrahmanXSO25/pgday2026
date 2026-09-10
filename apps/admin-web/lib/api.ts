/**
 * lib/api.ts — thin HTTP client for admin-web → api via same-origin /api proxy.
 * All data flows through API; no direct DB imports (§8 constraint).
 * Uses Next.js rewrite: /api/:path* → API_BASE_URL/v1/:path*
 */

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
 * Core fetch helper — always sends credentials (cookie) and expects JSON.
 * Path must include leading slash and be relative to /api (e.g. "/auth/me").
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = path.startsWith("/api") ? path : `/api${path.startsWith("/") ? path : `/${path}`}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    // §30.2 CSRF defense-in-depth — required by api on admin mutations in production
    "X-Requested-With": "pgegypt-admin",
    ...(init.headers as Record<string, string> | undefined),
  };

  // Remove Content-Type for GET/HEAD with no body to avoid preflight noise
  if (!init.body) {
    // keep it — API expects JSON, but GET doesn't need it; leaving is harmless
  }

  const res = await fetch(url, {
    ...init,
    headers,
    credentials: "include",
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

    // §14.3 — session expired/revoked: send the organizer back to login once.
    // Skip for the login endpoint itself so the form can show the real error.
    if (res.status === 401 && typeof window !== "undefined" && !path.includes("/auth/login")) {
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
 * Login sets httpOnly cookie via Set-Cookie from API (through proxy).
 */
export function login(payload: LoginPayload): Promise<LoginResponse> {
  return apiPost<LoginResponse>("/auth/login", payload);
}

export function fetchMe(): Promise<MeResponse> {
  return apiFetch<ApiSuccess<MeResponse>>("/auth/me", { method: "GET" }).then((r) => r.data);
}

export function logout(): Promise<void> {
  return apiFetch("/auth/logout", { method: "POST" }).then(() => undefined);
}
