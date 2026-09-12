"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch, ApiClientError } from "@/lib/api";

/**
 * Admin Speakers page — CRUD via same-origin /api proxy (§38 minimal moves)
 * Reuses card styling from existing speaker-card (file-by-file copy, simplified for admin).
 */

type ApiSpeaker = {
  id: string;
  slug: string;
  name: string;
  role?: string | null;
  company?: string | null;
  bio: string;
  photoUrl?: string | null;
  photo_url?: string | null;
  linkedin?: string | null;
  twitter?: string | null;
  isDraft?: number;
};

export default function SpeakersPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ slug: "", name: "", bio: "", role: "", company: "" });
  const [error, setError] = useState<string | null>(null);

  const speakersQ = useQuery({
    queryKey: ["admin", "speakers"],
    queryFn: async () => {
      const res = await apiFetch<{ success: true; data: ApiSpeaker[] }>("/speakers", {
        method: "GET",
      });
      return res.data;
    },
    retry: false,
  });

  const createMut = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const res = await apiFetch<{ success: true; data: ApiSpeaker }>("/speakers", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "speakers"] });
      setForm({ slug: "", name: "", bio: "", role: "", company: "" });
      setError(null);
    },
    onError: (e: unknown) => {
      const msg =
        e instanceof ApiClientError ? e.message : e instanceof Error ? e.message : "Create failed";
      setError(msg);
    },
  });

  const togglePublish = useMutation({
    mutationFn: async ({ id, isDraft }: { id: string; isDraft: number }) => {
      const res = await apiFetch<{ success: true; data: ApiSpeaker }>(`/speakers/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ isDraft }),
      });
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "speakers"] });
      setError(null);
    },
    onError: (e: unknown) => {
      const msg =
        e instanceof ApiClientError ? e.message : e instanceof Error ? e.message : "Update failed";
      setError(msg);
    },
  });

  const onCreate = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.slug.trim() || !form.name.trim() || form.bio.trim().length < 20) {
      setError("Slug, name and bio (≥20 chars) are required.");
      return;
    }
    createMut.mutate({
      slug: form.slug.trim().toLowerCase(),
      name: form.name.trim(),
      bio: form.bio.trim(),
      role: form.role.trim() || undefined,
      company: form.company.trim() || undefined,
    });
  };

  return (
    <div className="w-full">
      <p className="admin-label text-pg-blue mb-2">Content</p>
      <h1 className="text-2xl font-bold tracking-tight">Speakers</h1>
      <p className="text-ink-muted mt-1 text-sm">
        Add and edit speakers. Only published speakers appear on the website after the next publish.
      </p>

      <div className="card mt-6 p-5">
        <h2 className="text-sm font-semibold">Create speaker</h2>
        <form onSubmit={onCreate} className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="admin-label text-ink-muted text-xs uppercase">URL slug</span>
            <input
              placeholder="e.g. karim-el-sayed"
              value={form.slug}
              onChange={(e) => setForm((s) => ({ ...s, slug: e.target.value }))}
              className="border-hairline bg-surface mt-1 w-full rounded-sm border px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="admin-label text-ink-muted text-xs uppercase">Full name</span>
            <input
              placeholder="e.g. Sara Abdelrahman"
              value={form.name}
              onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
              className="border-hairline bg-surface mt-1 w-full rounded-sm border px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="admin-label text-ink-muted text-xs uppercase">
              Job title <span className="font-normal tracking-normal normal-case">(optional)</span>
            </span>
            <input
              placeholder="e.g. Backend Engineer"
              value={form.role}
              onChange={(e) => setForm((s) => ({ ...s, role: e.target.value }))}
              className="border-hairline bg-surface mt-1 w-full rounded-sm border px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="admin-label text-ink-muted text-xs uppercase">
              Company <span className="font-normal tracking-normal normal-case">(optional)</span>
            </span>
            <input
              placeholder="e.g. Acme"
              value={form.company}
              onChange={(e) => setForm((s) => ({ ...s, company: e.target.value }))}
              className="border-hairline bg-surface mt-1 w-full rounded-sm border px-3 py-2 text-sm"
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="admin-label text-ink-muted text-xs uppercase">
              Biography (at least 20 characters)
            </span>
            <textarea
              placeholder="Short professional biography"
              value={form.bio}
              onChange={(e) => setForm((s) => ({ ...s, bio: e.target.value }))}
              className="border-hairline bg-surface mt-1 w-full rounded-sm border px-3 py-2 text-sm"
              rows={3}
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
              <span role="alert" className="text-pg-amber ml-3 text-sm">
                {error}
              </span>
            ) : null}
          </div>
        </form>
      </div>

      <div className="mt-6">
        {speakersQ.isLoading ? (
          <p className="admin-label text-ink-muted text-sm">Loading…</p>
        ) : speakersQ.isError ? (
          <p role="alert" className="text-sm text-red-600">
            {(speakersQ.error as Error).message}
          </p>
        ) : speakersQ.data?.length === 0 ? (
          <p className="admin-label text-ink-muted text-sm">No speakers yet.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {(speakersQ.data ?? []).map((row) => (
              <li key={row.id} className="card p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-base font-bold">{row.name}</h3>
                  <span
                    className={`rounded-sm px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${
                      row.isDraft ? "bg-pg-amber/10 text-pg-amber" : "bg-pg-blue/10 text-pg-blue"
                    }`}
                  >
                    {row.isDraft ? "Draft" : "Published"}
                  </span>
                </div>
                <p className="admin-label text-ink-muted mt-1 text-xs">
                  {row.role ?? "—"} · {row.company ?? "—"}
                </p>
                <p className="text-ink-muted mt-2 line-clamp-3 text-sm leading-relaxed">
                  {row.bio}
                </p>
                <div className="mt-3 flex items-center justify-between">
                  <p className="admin-label text-ink-muted text-xs">/{row.slug}</p>
                  <button
                    onClick={() =>
                      togglePublish.mutate({ id: row.id, isDraft: row.isDraft ? 0 : 1 })
                    }
                    disabled={togglePublish.isPending}
                    className={`rounded-sm border px-2.5 py-1 text-xs font-semibold disabled:opacity-50 ${
                      row.isDraft
                        ? "border-pg-blue bg-pg-blue hover:bg-pg-blue-dark text-white"
                        : "border-hairline bg-surface text-ink hover:bg-surfaceRaised"
                    }`}
                  >
                    {row.isDraft ? "Publish" : "Unpublish"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
