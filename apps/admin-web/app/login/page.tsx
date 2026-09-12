"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { ApiClientError, setAccessToken } from "@/lib/api";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") ?? "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const loginMut = useMutation({
    mutationFn: async (payload: { email: string; password: string }) => {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787"}/v1/auth/login`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );

      const body = await res.json().catch(() => null);

      if (!res.ok) {
        const msg =
          (body as { message?: string })?.message ??
          (body as { error?: string })?.error ??
          res.statusText ??
          "Login failed";
        const fieldErrors = (body as { fieldErrors?: Record<string, string> })?.fieldErrors;
        const detail = fieldErrors ? `${msg}: ${Object.values(fieldErrors).join(", ")}` : msg;
        throw new ApiClientError(
          res.status,
          (body as { error?: string })?.error ?? `HTTP_${res.status}`,
          detail,
          fieldErrors
        );
      }

      // Store bearer token for cross-origin API calls (static Pages admin)
      const data = (body as { success: true; data: { accessToken?: string; user: unknown } }).data;
      if (data?.accessToken) {
        setAccessToken(data.accessToken);
      }

      return body as { success: true; data: { user: unknown } };
    },
    onSuccess: () => {
      setFormError(null);
      router.push(nextPath);
      router.refresh();
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof ApiClientError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Login failed";
      setFormError(msg);
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!email.trim() || !password) {
      setFormError("Email and password are required.");
      return;
    }
    loginMut.mutate({ email: email.trim(), password: password.trim() });
  };

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
      <div>
        <label htmlFor="email" className="admin-label text-ink-muted block text-xs uppercase">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="border-hairline bg-surface focus:border-pg-blue focus:ring-pg-blue/20 mt-1 w-full rounded-sm border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
          placeholder="admin@pgegypt.org"
        />
      </div>

      <div>
        <label htmlFor="password" className="admin-label text-ink-muted block text-xs uppercase">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="border-hairline bg-surface focus:border-pg-blue focus:ring-pg-blue/20 mt-1 w-full rounded-sm border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
        />
      </div>

      {formError ? (
        <div
          role="alert"
          className="border-pg-amber bg-surface-raised text-ink rounded-sm border px-3 py-2 text-sm"
        >
          {formError}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={loginMut.isPending}
        className="bg-pg-blue hover:bg-pg-blue-dark disabled:bg-ink-muted inline-flex w-full items-center justify-center rounded-sm px-4 py-2.5 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed"
      >
        {loginMut.isPending ? "Signing in…" : "Sign in"}
      </button>

      <p className="admin-label text-ink-muted text-center text-xs">
        Restricted area — organizers only
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-10 sm:px-6 sm:py-12">
      <div className="card p-6 sm:p-8">
        <h1 className="text-xl font-bold tracking-tight">Sign in</h1>
        <p className="text-ink-muted mt-2 text-sm leading-relaxed">
          Sign in to manage the PG Day Egypt website, registrations and check-in.
        </p>

        <Suspense
          fallback={
            <div className="mt-6 space-y-4">
              <div className="bg-surface-raised h-10 animate-pulse rounded-sm" />
              <div className="bg-surface-raised h-10 animate-pulse rounded-sm" />
              <div className="bg-pg-blue/20 h-10 animate-pulse rounded-sm" />
            </div>
          }
        >
          <LoginForm />
        </Suspense>
      </div>

      <p className="text-ink-muted admin-label mt-4 text-center text-xs">PG Day Egypt organizers</p>
    </div>
  );
}
