"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch, ApiClientError } from "@/lib/api";
import { humanizeStatus } from "@/lib/format";

type ApiRegistration = {
  id: string;
  name: string;
  email: string;
  organization?: string | null;
  role?: string | null;
  status: string;
  checkedInAt?: number | null;
};

export default function RegistrationsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  const regsQ = useQuery({
    queryKey: ["admin", "registrations", status],
    queryFn: async () => {
      const qs = status ? `?status=${status}` : "";
      const res = await apiFetch<{ success: true; data: ApiRegistration[] }>(
        `/registrations${qs}`,
        { method: "GET" }
      );
      return res.data;
    },
    retry: false,
  });

  const patchMut = useMutation({
    mutationFn: async ({ id, next }: { id: string; next: string }) => {
      await apiFetch(`/registrations/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "registrations"] }),
    onError: (e) => setError(e instanceof ApiClientError ? e.message : String(e)),
  });

  return (
    <div className="w-full">
      <h1 className="text-3xl font-bold tracking-tight">Registrations</h1>
      <p className="text-ink-muted mt-2 text-sm">
        Everyone who signed up. Changing a status notifies the attendee by email.
      </p>
      {error && (
        <p role="alert" className="text-pg-amber mt-3 text-sm">
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {[
          ["", "All"],
          ["pending", "Pending"],
          ["confirmed", "Confirmed"],
          ["waitlisted", "Waitlisted"],
          ["declined", "Declined"],
        ].map(([v, label]) => (
          <button
            key={v || "all"}
            onClick={() => setStatus(v)}
            className={`rounded-sm border px-3 py-1.5 text-xs font-medium ${status === v ? "border-pg-blue bg-pg-blue text-white" : "border-hairline bg-surface text-ink"}`}
          >
            {label}
          </button>
        ))}
        {/* §26.3 — CSV export via same-origin proxy */}
        <a
          href="/api/registrations/export.csv"
          className="border-hairline bg-surface-raised text-ink hover:border-pg-blue ml-auto rounded-sm border px-3 py-1.5 text-xs font-medium"
          download
        >
          Export CSV
        </a>
      </div>

      {regsQ.isLoading ? (
        <p className="text-ink-muted mt-4">Loading…</p>
      ) : (
        <ul className="mt-4 max-w-3xl space-y-2">
          {(regsQ.data ?? []).map((r) => (
            <li key={r.id} className="card flex items-center justify-between rounded-sm border p-3">
              <div className="min-w-0">
                <p className="text-ink truncate text-sm font-semibold">{r.name}</p>
                <p className="admin-label text-ink-muted text-[11px]">
                  {r.email}
                  {r.organization ? ` · ${r.organization}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {r.checkedInAt ? (
                  <span className="admin-label text-pg-blue text-[11px]">checked in</span>
                ) : null}
                <span className="admin-label text-ink-muted text-[11px] uppercase">
                  {humanizeStatus(r.status)}
                </span>
                <select
                  aria-label={`Status for ${r.name}`}
                  className="border-hairline bg-surface rounded-sm border px-2 py-1 text-xs"
                  value={r.status}
                  onChange={(e) => patchMut.mutate({ id: r.id, next: e.target.value })}
                >
                  {["pending", "confirmed", "waitlisted", "declined"].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </li>
          ))}
        </ul>
      )}
      {(regsQ.data ?? []).length === 0 && !regsQ.isLoading && (
        <p className="text-ink-muted mt-4 text-sm">No registrations match this filter.</p>
      )}
    </div>
  );
}
