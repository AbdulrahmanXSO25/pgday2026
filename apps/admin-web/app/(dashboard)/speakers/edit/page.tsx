"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, Suspense } from "react";
import { apiFetch, ApiClientError } from "@/lib/api";
import { PhotoUpload } from "@/components/photo-upload";

type ApiSpeaker = {
  id: string;
  slug: string;
  name: string;
  role?: string | null;
  company?: string | null;
  bio: string;
  photoUrl?: string | null;
  photoKey?: string | null;
  linkedin?: string | null;
  twitter?: string | null;
  isDraft?: number;
};

function SpeakerDetailPageInner() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id") ?? "";
  const qc = useQueryClient();
  const [form, setForm] = useState({
    slug: "",
    name: "",
    bio: "",
    role: "",
    company: "",
    linkedin: "",
    twitter: "",
    photoUrl: "",
    photoKey: "",
  });
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const speakerQ = useQuery({
    queryKey: ["admin", "speaker", id],
    queryFn: async () => {
      const res = await apiFetch<{ success: true; data: ApiSpeaker }>(`/speakers/${id}`, {
        method: "GET",
      });
      setForm((f) => ({
        slug: res.data.slug,
        name: res.data.name,
        bio: res.data.bio ?? "",
        role: res.data.role ?? "",
        company: res.data.company ?? "",
        linkedin: res.data.linkedin ?? "",
        twitter: res.data.twitter ?? "",
        photoUrl: res.data.photoUrl ?? "",
        photoKey: res.data.photoKey ?? "",
      }));
      setStatus(res.data.isDraft === 1 ? "draft" : "published");
      return res.data;
    },
    retry: false,
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      const res = await apiFetch<{ success: true; data: ApiSpeaker }>(`/speakers/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          slug: form.slug,
          name: form.name,
          bio: form.bio,
          role: form.role,
          company: form.company,
          linkedin: form.linkedin,
          twitter: form.twitter,
          photoUrl: form.photoUrl || null,
          photoKey: form.photoKey || null,
        }),
      });
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "speakers"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
    onError: (e) => setError(e instanceof ApiClientError ? e.message : String(e)),
  });

  const statusMut = useMutation({
    mutationFn: async (next: string) => {
      await apiFetch(`/speakers/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ isDraft: next === "draft" ? 1 : 0 }),
      });
    },
    onSuccess: (_d, next) => {
      setStatus(next);
      qc.invalidateQueries({ queryKey: ["admin", "speaker", id] });
    },
  });

  const delMut = useMutation({
    mutationFn: async () => {
      await apiFetch(`/speakers/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      window.location.href = "/speakers";
    },
  });

  if (speakerQ.isLoading) return <p className="text-ink-muted">Loading speaker…</p>;
  if (speakerQ.isError || !speakerQ.data) {
    return (
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Speaker not found</h1>
        <Link href="/speakers" className="text-pg-blue text-sm hover:underline">
          ← Back to speakers
        </Link>
      </div>
    );
  }

  const s = speakerQ.data;
  return (
    <div className="w-full">
      <Link href="/speakers" className="text-pg-blue text-sm hover:underline">
        ← Speakers
      </Link>
      <div className="mt-2 flex items-center gap-3">
        <h1 className="text-3xl font-bold tracking-tight">{s.name}</h1>
        <span
          className={`admin-label rounded-sm border px-2 py-0.5 text-xs ${status === "draft" ? "border-pg-amber text-pg-amber" : "border-pg-blue text-pg-blue"}`}
        >
          {status}
        </span>
      </div>
      <p className="text-ink-muted admin-label mt-1 text-xs">Page address: /speakers/{s.slug}</p>

      {error && (
        <p role="alert" className="text-pg-amber mt-3 text-sm">
          {error}
        </p>
      )}

      <div className="mt-6 grid max-w-4xl gap-6 lg:grid-cols-[240px_1fr]">
        {/* Photo column */}
        <div className="card h-fit p-5">
          <PhotoUpload
            kind="speaker_photo"
            prefix="speakers"
            currentUrl={form.photoUrl || undefined}
            onUploaded={(url, key) => setForm((f) => ({ ...f, photoUrl: url, photoKey: key }))}
            label="Portrait"
            hint="JPG, PNG or WebP, up to 5 MB. Shown on the speaker card and detail page."
          />
        </div>

        {/* Details column */}
        <div className="card space-y-4 p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            {(
              [
                ["slug", "URL slug"],
                ["name", "Full name"],
                ["role", "Job title"],
                ["company", "Company"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="block">
                <span className="admin-label text-ink-muted text-xs uppercase">{label}</span>
                <input
                  className="border-hairline bg-surface mt-1 w-full rounded-sm border px-3 py-2 text-sm"
                  value={form[k]}
                  onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                />
              </label>
            ))}
          </div>

          <label className="block">
            <span className="admin-label text-ink-muted text-xs uppercase">Biography</span>
            <textarea
              className="border-hairline bg-surface mt-1 w-full rounded-sm border px-3 py-2 text-sm"
              rows={6}
              value={form.bio}
              onChange={(e) => setForm({ ...form, bio: e.target.value })}
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="admin-label text-ink-muted text-xs uppercase">LinkedIn URL</span>
              <input
                className="border-hairline bg-surface mt-1 w-full rounded-sm border px-3 py-2 text-sm"
                placeholder="https://linkedin.com/in/…"
                value={form.linkedin}
                onChange={(e) => setForm({ ...form, linkedin: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="admin-label text-ink-muted text-xs uppercase">X / Twitter URL</span>
              <input
                className="border-hairline bg-surface mt-1 w-full rounded-sm border px-3 py-2 text-sm"
                placeholder="https://x.com/…"
                value={form.twitter}
                onChange={(e) => setForm({ ...form, twitter: e.target.value })}
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending}
              className="bg-pg-blue rounded-sm px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {saveMut.isPending ? "Saving…" : "Save changes"}
            </button>
            {saved && <span className="text-sm text-green-600">Saved ✓</span>}
            <button
              onClick={() => statusMut.mutate(status === "draft" ? "published" : "draft")}
              disabled={statusMut.isPending}
              className="border-hairline bg-surface-raised rounded-sm border px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {status === "draft" ? "Mark published" : "Mark draft"}
            </button>
            <button
              onClick={() => {
                if (confirm("Delete this speaker?")) delMut.mutate();
              }}
              disabled={delMut.isPending}
              className="text-pg-amber rounded-sm px-4 py-2 text-sm font-medium hover:underline"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SpeakerDetailPage() {
  return (
    <Suspense fallback={<div className="text-ink-muted p-8 text-sm">Loading…</div>}>
      <SpeakerDetailPageInner />
    </Suspense>
  );
}
