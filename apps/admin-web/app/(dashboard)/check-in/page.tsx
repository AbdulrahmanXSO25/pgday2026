"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiFetch, ApiClientError } from "@/lib/api";

/**
 * Admin Check-in page — §22
 * POST /v1/check-in validates opaque token, idempotent,
 * rejects non-confirmed 400, requires registrations:WRITE.
 * UI follows tokens/blue domination — minimal, admin-label, card.
 */

type CheckinResponse = {
  registrationId: string;
  status: "checked_in" | "already_checked_in";
  checkedInAt: number | null;
  registration: {
    id: string;
    name: string;
    email: string;
    status: string;
    checkedInAt?: number | null;
    checked_in_at?: number | null;
  };
};

export default function CheckInPage() {
  const [token, setToken] = useState("");
  const [result, setResult] = useState<CheckinResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const checkinMut = useMutation({
    mutationFn: async (t: string) => {
      const res = await apiFetch<{ success: true; data: CheckinResponse }>("/check-in", {
        method: "POST",
        body: JSON.stringify({ token: t }),
      });
      return res.data;
    },
    onSuccess: (data) => {
      setResult(data);
      setError(null);
    },
    onError: (e: unknown) => {
      const msg =
        e instanceof ApiClientError
          ? `${e.code}: ${e.message}`
          : e instanceof Error
            ? e.message
            : "Check-in failed";
      setError(msg);
      setResult(null);
    },
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    const t = token.trim();
    if (!t) {
      setError("Token is required.");
      return;
    }
    checkinMut.mutate(t);
  };

  const checkedAt =
    result?.checkedInAt ??
    result?.registration?.checkedInAt ??
    result?.registration?.checked_in_at ??
    null;

  return (
    <div className="w-full">
      <p className="admin-label text-pg-blue mb-2">Event day</p>
      <h1 className="text-2xl font-bold tracking-tight">Check-in</h1>
      <p className="text-ink-muted mt-1 text-sm">
        Type or paste an attendee&apos;s check-in code to check them in. Checking in twice simply
        confirms again.
      </p>

      <div className="card mt-6 p-5">
        <h2 className="text-sm font-semibold">Check in attendee</h2>
        <form onSubmit={onSubmit} className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label htmlFor="checkin-token" className="admin-label text-ink-muted text-xs uppercase">
              Check-in code
            </label>
            <input
              id="checkin-token"
              placeholder="Paste the code from the confirmation email"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="border-hairline bg-surface mt-1 w-full rounded-sm border px-3 py-2 text-sm"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <button
            type="submit"
            disabled={checkinMut.isPending}
            className="bg-pg-blue hover:bg-pg-blue-dark inline-flex h-9 items-center justify-center rounded-sm px-4 text-sm font-semibold text-white disabled:opacity-50"
          >
            {checkinMut.isPending ? "Checking…" : "Check in"}
          </button>
        </form>
        {error ? (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {error}
          </p>
        ) : null}
        <p className="admin-label text-ink-muted mt-3 text-xs">
          Only confirmed registrations can be checked in.
        </p>
      </div>

      {result ? (
        <div className="card mt-6 p-5">
          <h2 className="text-sm font-semibold">Result</h2>
          <div className="mt-3 grid gap-2 text-sm">
            <p>
              <span className="admin-label text-ink-muted text-xs uppercase">Status</span>{" "}
              <span
                className={
                  result.status === "checked_in"
                    ? "rounded-sm border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700"
                    : "rounded-sm border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700"
                }
              >
                {result.status === "checked_in" ? "Checked in" : "Already checked in"}
              </span>
            </p>
            <p className="admin-label text-ink-muted text-xs">
              {result.registration.name} · {result.registration.email}
            </p>
            {checkedAt ? (
              <p className="admin-label text-ink-muted text-xs">
                Checked in {new Date((checkedAt as number) * 1000).toLocaleString()}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
