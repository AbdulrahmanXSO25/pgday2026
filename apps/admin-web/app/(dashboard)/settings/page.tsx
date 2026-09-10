"use client";

import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch, ApiClientError } from "@/lib/api";

/**
 * Settings — event + site-config editor (§16.4) + explicit Publish (§16).
 * venueStatus stays tba-honest: venueName/Address only apply when confirmed.
 */

type ApiEvent = {
  id: string;
  name: string;
  tagline?: string | null;
  date: string;
  dateDisplay?: string | null;
  city: string;
  venueStatus: string;
  venueName?: string | null;
  venueAddress?: string | null;
  timezone: string;
  settingsJson?: string | null;
};

export default function SettingsPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: "",
    tagline: "",
    city: "",
    venueStatus: "tba",
    venueName: "",
    venueAddress: "",
    showSponsors: true,
    showCountdown: true,
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const settingsQ = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: async () => {
      const res = await apiFetch<{ success: true; data: ApiEvent }>("/settings", { method: "GET" });
      let settings: Record<string, unknown> = {};
      try {
        settings = res.data.settingsJson ? JSON.parse(res.data.settingsJson) : {};
      } catch {}
      const features =
        (settings.features as { showSponsors?: boolean; showCountdown?: boolean }) ?? {};
      setForm({
        name: res.data.name,
        tagline: res.data.tagline ?? "",
        city: res.data.city,
        venueStatus: res.data.venueStatus,
        venueName: res.data.venueName ?? "",
        venueAddress: res.data.venueAddress ?? "",
        showSponsors: features.showSponsors ?? true,
        showCountdown: features.showCountdown ?? true,
      });
      return res.data;
    },
    retry: false,
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      await apiFetch("/settings", {
        method: "PATCH",
        body: JSON.stringify({
          name: form.name,
          tagline: form.tagline,
          city: form.city,
          venueStatus: form.venueStatus,
          venueName: form.venueStatus === "confirmed" ? form.venueName : null,
          venueAddress: form.venueStatus === "confirmed" ? form.venueAddress : null,
          features: { showSponsors: form.showSponsors, showCountdown: form.showCountdown },
        }),
      });
    },
    onSuccess: () => {
      setMsg("Settings saved. Changes go live after Publish.");
      qc.invalidateQueries({ queryKey: ["admin", "settings"] });
    },
    onError: (e) => setError(e instanceof ApiClientError ? e.message : String(e)),
  });

  const publishMut = useMutation({
    mutationFn: async () => {
      const res = await apiFetch<{
        success: true;
        data: { id: string; contentHash: string; writtenFiles: string[] };
      }>("/publish", { method: "POST", body: JSON.stringify({}) });
      return res.data;
    },
    onSuccess: (d) =>
      setMsg(
        `Published (#${d.id.slice(0, 8)}, ${d.writtenFiles.length} files). Rebuild public-web to go live.`
      ),
    onError: (e) => setError(e instanceof ApiClientError ? e.message : String(e)),
  });

  if (settingsQ.isError) {
    return (
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-pg-amber mt-3 text-sm">
          You don&apos;t have access to settings. Ask a super admin for access.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full">
      <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
      <p className="text-ink-muted mt-2 max-w-xl text-sm">
        Nothing here reaches the public website until you publish it. Venue stays{" "}
        <code className="admin-label">tba</code>-honest — no fabricated address.
      </p>
      {msg && (
        <p role="status" className="text-pg-blue mt-3 text-sm">
          {msg}
        </p>
      )}
      {error && (
        <p role="alert" className="text-pg-amber mt-3 text-sm">
          {error}
        </p>
      )}

      <div className="card mt-6 max-w-2xl space-y-4 p-6">
        <label className="block">
          <span className="admin-label text-ink-muted text-xs uppercase">Event name</span>
          <input
            className="border-hairline bg-surface mt-1 w-full rounded-sm border px-3 py-2 text-sm"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="admin-label text-ink-muted text-xs uppercase">Tagline</span>
          <input
            className="border-hairline bg-surface mt-1 w-full rounded-sm border px-3 py-2 text-sm"
            value={form.tagline}
            onChange={(e) => setForm({ ...form, tagline: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="admin-label text-ink-muted text-xs uppercase">City</span>
          <input
            className="border-hairline bg-surface mt-1 w-full rounded-sm border px-3 py-2 text-sm"
            value={form.city}
            onChange={(e) => setForm({ ...form, city: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="admin-label text-ink-muted text-xs uppercase">Venue</span>
          <select
            className="border-hairline bg-surface mt-1 w-full rounded-sm border px-3 py-2 text-sm"
            value={form.venueStatus}
            onChange={(e) => setForm({ ...form, venueStatus: e.target.value })}
          >
            <option value="tba">To be announced</option>
            <option value="confirmed">Confirmed</option>
          </select>
        </label>
        {form.venueStatus === "confirmed" && (
          <>
            <label className="block">
              <span className="admin-label text-ink-muted text-xs uppercase">Venue name</span>
              <input
                className="border-hairline bg-surface mt-1 w-full rounded-sm border px-3 py-2 text-sm"
                value={form.venueName}
                onChange={(e) => setForm({ ...form, venueName: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="admin-label text-ink-muted text-xs uppercase">Venue address</span>
              <input
                className="border-hairline bg-surface mt-1 w-full rounded-sm border px-3 py-2 text-sm"
                value={form.venueAddress}
                onChange={(e) => setForm({ ...form, venueAddress: e.target.value })}
              />
            </label>
          </>
        )}
        <div className="grid grid-cols-2 gap-4 pt-1">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.showSponsors}
              onChange={(e) => setForm({ ...form, showSponsors: e.target.checked })}
            />
            Show sponsors section
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.showCountdown}
              onChange={(e) => setForm({ ...form, showCountdown: e.target.checked })}
            />
            Show countdown
          </label>
        </div>
        <button
          onClick={() => saveMut.mutate()}
          disabled={saveMut.isPending}
          className="bg-pg-blue rounded-sm px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saveMut.isPending ? "Saving…" : "Save settings"}
        </button>
      </div>

      <div className="card mt-6 max-w-2xl p-6">
        <h2 className="text-lg font-bold">Publish to the website</h2>
        <p className="text-ink-muted mt-1 text-sm">
          Collects everything marked as published, checks it, and makes it live on the public
          website.
        </p>
        <div className="mt-3 flex gap-3">
          <button
            onClick={() => publishMut.mutate()}
            disabled={publishMut.isPending}
            className="bg-pg-blue rounded-sm px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {publishMut.isPending ? "Publishing…" : "Publish now"}
          </button>
          <Link
            href="/audit-log"
            className="border-hairline bg-surface-raised rounded-sm border px-4 py-2 text-sm font-medium"
          >
            Audit log →
          </Link>
        </div>
      </div>
    </div>
  );
}
