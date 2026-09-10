"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch, ApiClientError } from "@/lib/api";

/**
 * Admin Sponsors page — reuses sponsor-grid styling file-by-file (simplified)
 */

type ApiSponsor = {
  id: string;
  slug: string;
  name: string;
  tier: "platinum" | "gold" | "silver" | "community";
  logoUrl?: string | null;
  logo_url?: string | null;
  logo?: string;
  url: string;
  visible?: number;
  sortOrder?: number;
};

export default function SponsorsPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    slug: "",
    name: "",
    tier: "gold" as ApiSponsor["tier"],
    url: "https://example.com",
  });
  const [error, setError] = useState<string | null>(null);

  const sponsorsQ = useQuery({
    queryKey: ["admin", "sponsors"],
    queryFn: async () => {
      const res = await apiFetch<{ success: true; data: ApiSponsor[] }>("/sponsors", {
        method: "GET",
      });
      return res.data;
    },
    retry: false,
  });

  const createMut = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const res = await apiFetch<{ success: true; data: ApiSponsor }>("/sponsors", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "sponsors"] });
      setError(null);
    },
    onError: (e: unknown) => {
      const msg =
        e instanceof ApiClientError ? e.message : e instanceof Error ? e.message : "Create failed";
      setError(msg);
    },
  });

  const onCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.slug.trim() || !form.name.trim() || !form.url.trim()) {
      setError("Slug, name and URL are required.");
      return;
    }
    createMut.mutate({
      slug: form.slug.trim().toLowerCase(),
      name: form.name.trim(),
      tier: form.tier,
      url: form.url.trim(),
      visible: 1,
    });
  };

  const grouped = (sponsorsQ.data ?? []).reduce<Record<string, ApiSponsor[]>>((acc, s) => {
    (acc[s.tier] ??= []).push(s);
    return acc;
  }, {});

  return (
    <div className="w-full">
      <p className="admin-label text-pg-blue mb-2">Content</p>
      <h1 className="text-2xl font-bold tracking-tight">Sponsors</h1>
      <p className="text-ink-muted mt-1 text-sm">
        Manage sponsors by tier. Hidden sponsors stay out of the website until you show them and
        publish.
      </p>

      <div className="card mt-6 p-5">
        <h2 className="text-sm font-semibold">Create sponsor</h2>
        <form onSubmit={onCreate} className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="admin-label text-ink-muted text-xs uppercase">URL slug</span>
            <input
              placeholder="e.g. percona"
              value={form.slug}
              onChange={(e) => setForm((s) => ({ ...s, slug: e.target.value }))}
              className="border-hairline bg-surface mt-1 w-full rounded-sm border px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="admin-label text-ink-muted text-xs uppercase">Name</span>
            <input
              placeholder="e.g. Percona"
              value={form.name}
              onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
              className="border-hairline bg-surface mt-1 w-full rounded-sm border px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="admin-label text-ink-muted text-xs uppercase">Tier</span>
            <select
              value={form.tier}
              onChange={(e) =>
                setForm((s) => ({ ...s, tier: e.target.value as ApiSponsor["tier"] }))
              }
              className="border-hairline bg-surface mt-1 w-full rounded-sm border px-3 py-2 text-sm"
            >
              <option value="platinum">Platinum</option>
              <option value="gold">Gold</option>
              <option value="silver">Silver</option>
              <option value="community">Community</option>
            </select>
          </label>
          <label className="block">
            <span className="admin-label text-ink-muted text-xs uppercase">Website</span>
            <input
              placeholder="https://…"
              value={form.url}
              onChange={(e) => setForm((s) => ({ ...s, url: e.target.value }))}
              className="border-hairline bg-surface mt-1 w-full rounded-sm border px-3 py-2 text-sm"
            />
          </label>
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={createMut.isPending}
              className="bg-pg-blue hover:bg-pg-blue-dark inline-flex rounded-sm px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {createMut.isPending ? "Creating…" : "Create"}
            </button>
            {error ? (
              <span role="alert" className="ml-3 text-sm text-red-600">
                {error}
              </span>
            ) : null}
          </div>
        </form>
      </div>

      <div className="mt-6 space-y-6">
        {sponsorsQ.isLoading ? (
          <p className="admin-label text-ink-muted text-sm">Loading…</p>
        ) : sponsorsQ.isError ? (
          <p role="alert" className="text-sm text-red-600">
            {(sponsorsQ.error as Error).message}
          </p>
        ) : sponsorsQ.data?.length === 0 ? (
          <p className="admin-label text-ink-muted text-sm">No sponsors yet.</p>
        ) : (
          Object.entries(grouped).map(([tier, list]) => (
            <div key={tier}>
              <h3 className="admin-label text-ink-muted mb-2 text-xs uppercase">
                <span className="text-pg-blue">--</span> {tier}
              </h3>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((s) => (
                  <li key={s.id} className="card p-4">
                    <p className="text-sm font-semibold">{s.name}</p>
                    <p className="admin-label text-ink-muted text-xs">
                      /{s.slug} · {s.tier}
                    </p>
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-pg-blue text-xs hover:underline"
                    >
                      {s.url}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
