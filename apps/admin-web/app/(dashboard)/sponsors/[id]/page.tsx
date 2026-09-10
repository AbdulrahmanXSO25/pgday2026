"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch, ApiClientError } from "@/lib/api";

type ApiSponsor = {
  id: string;
  slug: string;
  name: string;
  tier: string;
  url: string;
  visible?: number;
  sortOrder?: number;
};

export default function SponsorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const [form, setForm] = useState({
    slug: "",
    name: "",
    tier: "gold",
    url: "",
    sortOrder: "0",
    visible: true,
  });
  const [error, setError] = useState<string | null>(null);

  const sponsorQ = useQuery({
    queryKey: ["admin", "sponsor", id],
    queryFn: async () => {
      const res = await apiFetch<{ success: true; data: ApiSponsor }>(`/sponsors/${id}`, {
        method: "GET",
      });
      setForm({
        slug: res.data.slug,
        name: res.data.name,
        tier: res.data.tier,
        url: res.data.url,
        sortOrder: String(res.data.sortOrder ?? 0),
        visible: res.data.visible !== 0,
      });
      return res.data;
    },
    retry: false,
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      await apiFetch(`/sponsors/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          slug: form.slug,
          name: form.name,
          tier: form.tier,
          url: form.url,
          sortOrder: Number(form.sortOrder),
          visible: form.visible ? 1 : 0,
        }),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "sponsors"] }),
    onError: (e) => setError(e instanceof ApiClientError ? e.message : String(e)),
  });

  if (sponsorQ.isLoading) return <p className="text-ink-muted">Loading sponsor…</p>;
  if (sponsorQ.isError || !sponsorQ.data) {
    return (
      <div>
        <h1 className="text-3xl font-bold">Sponsor not found</h1>
        <Link href="/sponsors" className="text-pg-blue text-sm hover:underline">
          ← Back to sponsors
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full">
      <Link href="/sponsors" className="text-pg-blue text-sm hover:underline">
        ← Sponsors
      </Link>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">{sponsorQ.data.name}</h1>
      <p className="text-ink-muted admin-label mt-1 text-xs">/{sponsorQ.data.slug}</p>
      {error && (
        <p role="alert" className="text-pg-amber mt-3 text-sm">
          {error}
        </p>
      )}

      <div className="card mt-6 max-w-2xl space-y-4 p-6">
        <label className="block">
          <span className="admin-label text-ink-muted text-xs uppercase">Name</span>
          <input
            className="border-hairline bg-surface mt-1 w-full rounded-sm border px-3 py-2 text-sm"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </label>
        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="admin-label text-ink-muted text-xs uppercase">URL slug</span>
            <input
              className="border-hairline bg-surface mt-1 w-full rounded-sm border px-3 py-2 text-sm"
              value={form.slug}
              onChange={(e) => setForm({ ...form, slug: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="admin-label text-ink-muted text-xs uppercase">Tier</span>
            <select
              className="border-hairline bg-surface mt-1 w-full rounded-sm border px-3 py-2 text-sm"
              value={form.tier}
              onChange={(e) => setForm({ ...form, tier: e.target.value })}
            >
              {[
                ["platinum", "Platinum"],
                ["gold", "Gold"],
                ["silver", "Silver"],
                ["community", "Community"],
              ].map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block">
          <span className="admin-label text-ink-muted text-xs uppercase">Website</span>
          <input
            className="border-hairline bg-surface mt-1 w-full rounded-sm border px-3 py-2 text-sm"
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="admin-label text-ink-muted text-xs uppercase">Display order</span>
          <input
            className="border-hairline bg-surface mt-1 w-full rounded-sm border px-3 py-2 text-sm"
            value={form.sortOrder}
            onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.visible}
            onChange={(e) => setForm({ ...form, visible: e.target.checked })}
          />
          Visible on the website
        </label>
        <button
          onClick={() => saveMut.mutate()}
          disabled={saveMut.isPending}
          className="bg-pg-blue rounded-sm px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saveMut.isPending ? "Saving…" : "Save sponsor"}
        </button>
      </div>
    </div>
  );
}
