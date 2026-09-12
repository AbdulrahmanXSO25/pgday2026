"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { humanizeAction, entityLabel, formatDateTime } from "@/lib/format";

/**
 * Activity log — super admins only. Read-only history of every change.
 * Filters: user, target type, date range. Paginated (50/page).
 */

type AuditRow = {
  id: string;
  actorId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: string | null;
  ipAddress?: string | null;
  createdAt: number;
};

type ApiUser = {
  id: string;
  email: string;
  displayName?: string | null;
};

const PAGE_SIZE = 50;

const TARGET_TYPES = [
  "event",
  "user",
  "speaker",
  "session",
  "room",
  "sponsor",
  "registration",
  "media",
  "cfp",
  "publication",
  "audit",
];

export default function AuditLogPage() {
  const [actorId, setActorId] = useState("");
  const [targetType, setTargetType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);

  const auditQ = useQuery({
    queryKey: ["admin", "audit", actorId, targetType, from, to, page],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (actorId) qs.set("actorId", actorId);
      if (targetType) qs.set("targetType", targetType);
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      qs.set("limit", String(PAGE_SIZE));
      qs.set("offset", String(page * PAGE_SIZE));
      const res = await apiFetch<{
        success: true;
        data: AuditRow[];
        meta: { count: number; total: number };
      }>(`/audit-logs?${qs.toString()}`, { method: "GET" });
      return res;
    },
    retry: false,
    refetchInterval: 15_000,
  });

  const usersQ = useQuery({
    queryKey: ["admin", "users-lite"],
    queryFn: async () => {
      const res = await apiFetch<{ success: true; data: ApiUser[] }>("/users", { method: "GET" });
      return res.data;
    },
    retry: false,
  });

  const actorName = (actorId: string | null | undefined): string => {
    if (!actorId) return "System";
    const user = (usersQ.data ?? []).find((u) => u.id === actorId);
    return user ? (user.displayName ?? user.email) : "A team member";
  };

  if (auditQ.isError) {
    return (
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Audit log</h1>
        <p className="text-pg-amber mt-3 text-sm">Only super admins can view the audit log.</p>
      </div>
    );
  }

  const rows = auditQ.data?.data ?? [];
  const total = auditQ.data?.meta.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="w-full">
      <h1 className="text-3xl font-bold tracking-tight">Audit log</h1>
      <p className="text-ink-muted mt-2 text-sm">
        A complete history of every change made in this panel, newest first.
      </p>

      {/* Filters */}
      <div className="card mt-4 flex flex-wrap items-end gap-3 p-4">
        <label className="block">
          <span className="admin-label text-ink-muted text-xs uppercase">User</span>
          <select
            value={actorId}
            onChange={(e) => {
              setActorId(e.target.value);
              setPage(0);
            }}
            className="border-hairline bg-surface mt-1 rounded-sm border px-3 py-1.5 text-sm"
          >
            <option value="">All users</option>
            {(usersQ.data ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName ?? u.email}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="admin-label text-ink-muted text-xs uppercase">Category</span>
          <select
            value={targetType}
            onChange={(e) => {
              setTargetType(e.target.value);
              setPage(0);
            }}
            className="border-hairline bg-surface mt-1 rounded-sm border px-3 py-1.5 text-sm"
          >
            <option value="">All categories</option>
            {TARGET_TYPES.map((t) => (
              <option key={t} value={t}>
                {entityLabel(t)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="admin-label text-ink-muted text-xs uppercase">From</span>
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(0);
            }}
            className="border-hairline bg-surface mt-1 rounded-sm border px-3 py-1.5 text-sm"
          />
        </label>
        <label className="block">
          <span className="admin-label text-ink-muted text-xs uppercase">To</span>
          <input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(0);
            }}
            className="border-hairline bg-surface mt-1 rounded-sm border px-3 py-1.5 text-sm"
          />
        </label>
        <button
          onClick={() => {
            setActorId("");
            setTargetType("");
            setFrom("");
            setTo("");
            setPage(0);
          }}
          className="border-hairline bg-surface-raised rounded-sm border px-3 py-1.5 text-xs font-medium"
        >
          Clear filters
        </button>
        <span className="text-ink-muted ml-auto text-xs">{total} records</span>
      </div>

      {auditQ.isLoading ? (
        <p className="text-ink-muted mt-4">Loading…</p>
      ) : (
        <ul className="mt-4 max-w-3xl space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="card rounded-sm border p-3">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-semibold">{humanizeAction(r.action)}</p>
                <p className="admin-label text-ink-muted text-[11px]">
                  {formatDateTime(r.createdAt)}
                </p>
              </div>
              <p className="admin-label text-ink-muted mt-1 text-[11px]">
                {entityLabel(r.targetType)} · {actorName(r.actorId)}
              </p>
            </li>
          ))}
          {rows.length === 0 && !auditQ.isLoading && (
            <p className="text-ink-muted text-sm">No audit records match these filters.</p>
          )}
        </ul>
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
            Page {page + 1} of {totalPages}
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
