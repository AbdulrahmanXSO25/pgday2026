"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { humanizeAction, entityLabel, formatDateTime } from "@/lib/format";

/**
 * Activity log — super admins only. Read-only history of every change.
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

export default function AuditLogPage() {
  const auditQ = useQuery({
    queryKey: ["admin", "audit"],
    queryFn: async () => {
      const res = await apiFetch<{ success: true; data: AuditRow[] }>("/audit-logs", {
        method: "GET",
      });
      return res.data;
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

  const rows = [...(auditQ.data ?? [])].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

  return (
    <div className="w-full">
      <h1 className="text-3xl font-bold tracking-tight">Audit log</h1>
      <p className="text-ink-muted mt-2 text-sm">
        A complete history of every change made in this panel, newest first.
      </p>
      {auditQ.isLoading ? (
        <p className="text-ink-muted mt-4">Loading…</p>
      ) : (
        <ul className="mt-4 max-w-3xl space-y-2">
          {rows.slice(0, 100).map((r) => (
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
          {rows.length === 0 && <p className="text-ink-muted text-sm">No audit records yet.</p>}
        </ul>
      )}
    </div>
  );
}
