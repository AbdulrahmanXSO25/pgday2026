"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { apiFetch, ApiClientError, getAccessToken } from "@/lib/api";
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

const PAGE_SIZE = 50;

export default function RegistrationsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const [bulkIds, setBulkIds] = useState<string[]>([]);
  const csvRef = useRef<HTMLInputElement>(null);

  const regsQ = useQuery({
    queryKey: ["admin", "registrations", status, page],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (status) qs.set("status", status);
      qs.set("limit", String(PAGE_SIZE));
      qs.set("offset", String(page * PAGE_SIZE));
      const res = await apiFetch<{
        success: true;
        data: ApiRegistration[];
        meta: { count: number; total: number };
      }>(`/registrations?${qs.toString()}`, { method: "GET" });
      return res;
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

  const bulkMut = useMutation({
    mutationFn: async ({ ids, next }: { ids: string[]; next: string }) => {
      const res = await apiFetch<{
        success: true;
        data: { updated: number; requested: number; status: string };
      }>("/registrations/bulk", {
        method: "POST",
        body: JSON.stringify({ ids, status: next }),
      });
      return res.data;
    },
    onSuccess: (d) => {
      setBulkMsg(`Updated ${d.updated} of ${d.requested} registrations → ${d.status}.`);
      setBulkIds([]);
      if (csvRef.current) csvRef.current.value = "";
      qc.invalidateQueries({ queryKey: ["admin", "registrations"] });
    },
    onError: (e) => setError(e instanceof ApiClientError ? e.message : String(e)),
  });

  const exportCsv = async () => {
    setError(null);
    try {
      const token = getAccessToken();
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787"}/v1/admin/registrations/export.csv`,
        {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            "X-Requested-With": "pgegypt-admin",
          },
        }
      );
      if (!res.ok) throw new Error(`Export failed (HTTP ${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `registrations-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    }
  };

  const handleBulkCsv = (file: File) => {
    setError(null);
    setBulkMsg(null);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const ids = text
        .split(/[\n,;]+/)
        .map((s) => s.trim())
        .filter((s) => /^[0-9a-f-]{8,}$/i.test(s));
      setBulkIds(ids);
      setBulkMsg(`Loaded ${ids.length} registration IDs from CSV.`);
    };
    reader.readAsText(file);
  };

  const total = regsQ.data?.meta.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

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
      {bulkMsg && (
        <p role="status" className="text-pg-blue mt-3 text-sm">
          {bulkMsg}
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
            onClick={() => {
              setStatus(v);
              setPage(0);
            }}
            className={`rounded-sm border px-3 py-1.5 text-xs font-medium ${status === v ? "border-pg-blue bg-pg-blue text-white" : "border-hairline bg-surface text-ink"}`}
          >
            {label}
          </button>
        ))}
        <button
          onClick={() => void exportCsv()}
          className="border-hairline bg-surface-raised text-ink hover:border-pg-blue ml-auto rounded-sm border px-3 py-1.5 text-xs font-medium"
        >
          Export CSV
        </button>
      </div>

      {/* Bulk actions */}
      <div className="card mt-4 max-w-3xl p-4">
        <h2 className="text-sm font-semibold">Bulk status change</h2>
        <p className="text-ink-muted mt-1 text-xs">
          Upload a CSV of registration IDs (one per line, or comma-separated) to accept, waitlist,
          or reject them all at once. The exported CSV includes the <code>id</code> column.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            ref={csvRef}
            type="file"
            accept=".csv,text/csv"
            className="border-hairline bg-surface rounded-sm border px-2 py-1.5 text-xs"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleBulkCsv(f);
            }}
          />
          {bulkIds.length > 0 && (
            <>
              <button
                onClick={() => bulkMut.mutate({ ids: bulkIds, next: "confirmed" })}
                disabled={bulkMut.isPending}
                className="bg-pg-blue rounded-sm px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                Accept all ({bulkIds.length})
              </button>
              <button
                onClick={() => bulkMut.mutate({ ids: bulkIds, next: "waitlisted" })}
                disabled={bulkMut.isPending}
                className="border-hairline bg-surface-raised rounded-sm border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
              >
                Waitlist all
              </button>
              <button
                onClick={() => bulkMut.mutate({ ids: bulkIds, next: "declined" })}
                disabled={bulkMut.isPending}
                className="text-pg-amber border-pg-amber/40 rounded-sm border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
              >
                Reject all
              </button>
            </>
          )}
        </div>
      </div>

      {regsQ.isLoading ? (
        <p className="text-ink-muted mt-4">Loading…</p>
      ) : (
        <ul className="mt-4 max-w-3xl space-y-2">
          {(regsQ.data?.data ?? []).map((r) => (
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
      {(regsQ.data?.data ?? []).length === 0 && !regsQ.isLoading && (
        <p className="text-ink-muted mt-4 text-sm">No registrations match this filter.</p>
      )}

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="border-hairline bg-surface rounded-sm border px-3 py-1.5 text-xs font-medium disabled:opacity-40"
          >
            ← Prev
          </button>
          <span className="text-ink-muted text-xs">
            Page {page + 1} of {totalPages} · {total} registrations
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="border-hairline bg-surface rounded-sm border px-3 py-1.5 text-xs font-medium disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
