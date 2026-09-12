"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, Suspense } from "react";
import { apiFetch, ApiClientError } from "@/lib/api";
import { roleLabel, moduleLabel } from "@/lib/format";

// Access areas — must match MODULES in packages/auth (kept local because this is
// a client component and the auth barrel pulls in Node-only code).
const MODULES = [
  "events",
  "users",
  "speakers",
  "sessions",
  "sponsors",
  "registrations",
  "media",
  "cfp",
  "publishing",
] as const;

/**
 * RBAC editor (§8.5) — SUPER_ADMIN only. Checkbox state is UX only; the API
 * enforces the matrix server-side (§13.3) including the self-modification block.
 */

type ApiUser = {
  id: string;
  email: string;
  displayName?: string;
  role: string;
  status?: string;
  permissions?: Array<{ module: string; canRead: number; canWrite: number }>;
};

function UserDetailPageInner() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id") ?? "";
  const qc = useQueryClient();
  const [matrix, setMatrix] = useState<Record<string, { read: boolean; write: boolean }>>({});
  const [error, setError] = useState<string | null>(null);

  const userQ = useQuery({
    queryKey: ["admin", "user", id],
    queryFn: async () => {
      const res = await apiFetch<{ success: true; data: ApiUser }>(`/users/${id}`, {
        method: "GET",
      });
      const m: Record<string, { read: boolean; write: boolean }> = {};
      for (const mod of MODULES as readonly string[]) m[mod] = { read: false, write: false };
      for (const p of res.data.permissions ?? []) {
        if (m[p.module]) m[p.module] = { read: p.canRead === 1, write: p.canWrite === 1 };
      }
      setMatrix(m);
      return res.data;
    },
    retry: false,
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      const permissions = (MODULES as readonly string[]).map((mod) => ({
        module: mod,
        canRead: matrix[mod]?.read ? 1 : 0,
        canWrite: matrix[mod]?.write ? 1 : 0,
      }));
      await apiFetch(`/users/${id}/permissions`, {
        method: "PATCH",
        body: JSON.stringify({ permissions }),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "user", id] }),
    onError: (e) => setError(e instanceof ApiClientError ? e.message : String(e)),
  });

  const toggle = (mod: string, key: "read" | "write", value: boolean) => {
    setMatrix((prev) => {
      const next = { ...prev, [mod]: { ...prev[mod] } };
      if (key === "write") {
        next[mod].write = value;
        if (value) next[mod].read = true; // §13.3 WRITE implies READ
      } else {
        next[mod].read = value;
        if (!value) next[mod].write = false; // unchecking READ unchecks WRITE
      }
      return next;
    });
  };

  if (userQ.isLoading) return <p className="text-ink-muted">Loading user…</p>;
  if (userQ.isError || !userQ.data) {
    return (
      <div>
        <h1 className="text-3xl font-bold">User not found</h1>
        <Link href="/users" className="text-pg-blue text-sm hover:underline">
          ← Back to users
        </Link>
      </div>
    );
  }

  const u = userQ.data;
  return (
    <div className="w-full">
      <Link href="/users" className="text-pg-blue text-sm hover:underline">
        ← Team
      </Link>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">{u.displayName ?? u.email}</h1>
      <p className="admin-label text-ink-muted mt-1 text-xs">
        {u.email} · {roleLabel(u.role)}
        {u.status === "disabled" ? " · Disabled" : ""}
      </p>
      {error && (
        <p role="alert" className="text-pg-amber mt-3 text-sm">
          {error}
        </p>
      )}

      {u.role === "SUPER_ADMIN" ? (
        <div className="card mt-6 max-w-xl p-6">
          <p className="text-sm">
            Super admins always have full access — there is nothing to configure here.
          </p>
        </div>
      ) : (
        <div className="card mt-6 max-w-xl p-6">
          <h2 className="text-lg font-bold">Module permissions</h2>
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="admin-label text-ink-muted text-xs uppercase">
                <th className="pb-2 text-left">Area</th>
                <th className="pb-2 text-center">View</th>
                <th className="pb-2 text-center">Edit</th>
              </tr>
            </thead>
            <tbody>
              {(MODULES as readonly string[]).map((mod) => (
                <tr key={mod} className="border-hairline border-t">
                  <td className="py-2 text-sm font-medium">{moduleLabel(mod)}</td>
                  <td className="py-2 text-center">
                    <input
                      type="checkbox"
                      checked={matrix[mod]?.read ?? false}
                      onChange={(e) => toggle(mod, "read", e.target.checked)}
                    />
                  </td>
                  <td className="py-2 text-center">
                    <input
                      type="checkbox"
                      checked={matrix[mod]?.write ?? false}
                      onChange={(e) => toggle(mod, "write", e.target.checked)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="admin-label text-ink-muted mt-3 text-[11px]">
            Selecting Edit also grants View. All permission changes are logged.
          </p>
          <button
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending}
            className="bg-pg-blue mt-4 rounded-sm px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saveMut.isPending ? "Saving…" : "Save permissions"}
          </button>
        </div>
      )}
    </div>
  );
}

export default function UserDetailPage() {
  return (
    <Suspense fallback={<div className="text-ink-muted p-8 text-sm">Loading…</div>}>
      <UserDetailPageInner />
    </Suspense>
  );
}
