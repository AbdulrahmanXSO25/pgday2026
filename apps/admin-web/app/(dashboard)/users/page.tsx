"use client";

import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch, ApiClientError } from "@/lib/api";
import { roleLabel } from "@/lib/format";

/**
 * Users — SUPER_ADMIN only (§13.4). The API enforces the role gate regardless
 * of what this page renders; non-SUPER_ADMIN get 403 on /users endpoints.
 */

type ApiUser = { id: string; email: string; displayName?: string; role: string; status?: string };

export default function UsersPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ email: "", password: "", displayName: "", role: "ADMIN" });
  const [error, setError] = useState<string | null>(null);

  const usersQ = useQuery({
    queryKey: ["admin", "users"],
    queryFn: async () => {
      const res = await apiFetch<{ success: true; data: ApiUser[] }>("/users", { method: "GET" });
      return res.data;
    },
    retry: false,
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const res = await apiFetch<{ success: true; data: ApiUser }>("/users", {
        method: "POST",
        body: JSON.stringify({
          email: form.email,
          password: form.password,
          displayName: form.displayName,
          role: form.role,
        }),
      });
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
      setForm({ email: "", password: "", displayName: "", role: "ADMIN" });
    },
    onError: (e) => setError(e instanceof ApiClientError ? e.message : String(e)),
  });

  const disableMut = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      await apiFetch(`/users/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "users"] }),
    onError: (e) => setError(e instanceof ApiClientError ? e.message : String(e)),
  });

  if (usersQ.isError) {
    return (
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Users</h1>
        <p className="text-pg-amber mt-3 text-sm">Only super admins can manage the team.</p>
      </div>
    );
  }

  return (
    <div className="w-full">
      <h1 className="text-3xl font-bold tracking-tight">Team</h1>
      <p className="text-ink-muted mt-2 text-sm">
        Manage who can sign in and what each person is allowed to do.
      </p>
      {error && (
        <p role="alert" className="text-pg-amber mt-3 text-sm">
          {error}
        </p>
      )}

      <div className="card mt-6 max-w-xl space-y-3 p-6">
        <h2 className="text-lg font-bold">Add team member</h2>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="admin-label text-ink-muted text-xs uppercase">Email</span>
            <input
              placeholder="name@company.com"
              className="border-hairline bg-surface mt-1 w-full rounded-sm border px-3 py-2 text-sm"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="admin-label text-ink-muted text-xs uppercase">Temporary password</span>
            <input
              placeholder="At least 8 characters"
              type="password"
              className="border-hairline bg-surface mt-1 w-full rounded-sm border px-3 py-2 text-sm"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="admin-label text-ink-muted text-xs uppercase">Display name</span>
            <input
              placeholder="e.g. Sara Abdelrahman"
              className="border-hairline bg-surface mt-1 w-full rounded-sm border px-3 py-2 text-sm"
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="admin-label text-ink-muted text-xs uppercase">Role</span>
            <select
              aria-label="Role"
              className="border-hairline bg-surface mt-1 w-full rounded-sm border px-3 py-2 text-sm"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            >
              <option value="ADMIN">Admin</option>
              <option value="SUPER_ADMIN">Super admin</option>
            </select>
          </label>
        </div>
        <button
          onClick={() => createMut.mutate()}
          disabled={createMut.isPending}
          className="bg-pg-blue rounded-sm px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {createMut.isPending ? "Adding…" : "Add member"}
        </button>
      </div>

      <ul className="mt-6 max-w-xl space-y-2">
        {(usersQ.data ?? []).map((u) => (
          <li key={u.id} className="card flex items-center justify-between rounded-sm border p-3">
            <div className="min-w-0">
              <Link
                href={`/users/${u.id}`}
                className="text-ink text-sm font-semibold hover:underline"
              >
                {u.displayName ?? u.email}
              </Link>
              <p className="admin-label text-ink-muted text-[11px]">
                {u.email} · {roleLabel(u.role)}
                {u.status === "disabled" ? " · Disabled" : ""}
              </p>
            </div>
            <button
              onClick={() => {
                const action = u.status === "disabled" ? "re-enable" : "disable";
                if (
                  confirm(
                    `${action === "disable" ? "Disable" : "Re-enable"} ${u.displayName ?? u.email}?${action === "disable" ? " They will be signed out immediately." : ""}`
                  )
                ) {
                  disableMut.mutate({
                    id: u.id,
                    status: u.status === "disabled" ? "active" : "disabled",
                  });
                }
              }}
              className={`rounded-sm border px-2 py-1 text-xs ${u.status === "disabled" ? "border-pg-blue text-pg-blue" : "border-pg-amber text-pg-amber"}`}
            >
              {u.status === "disabled" ? "Enable" : "Disable"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
