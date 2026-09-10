"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch, ApiClientError } from "@/lib/api";
import { humanizeStatus } from "@/lib/format";

type ApiSession = {
  id: string;
  slug: string;
  title: string;
  type: string;
  level?: string | null;
  abstract?: string | null;
  roomId?: string | null;
  startsAtEpoch?: number | null;
  endsAtEpoch?: number | null;
  isDraft?: number;
  status?: string;
  speakerIds?: string[];
};

type ApiSpeakerLite = {
  id: string;
  name: string;
};

type ApiRoom = {
  id: string;
  name: string;
  slug: string;
};

/** Unix seconds → "YYYY-MM-DDTHH:mm" for datetime-local inputs (local time) */
function epochToLocalInput(epoch: number | null | undefined): string {
  if (!epoch) return "";
  const d = new Date(epoch * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function SessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const [form, setForm] = useState({ slug: "", title: "", type: "talk", level: "", abstract: "" });
  const [selectedSpeakers, setSelectedSpeakers] = useState<string[]>([]);
  const [slot, setSlot] = useState({ roomId: "", startAt: "", endAt: "" });
  const [error, setError] = useState<string | null>(null);

  const speakersQ = useQuery({
    queryKey: ["admin", "speakers-lite"],
    queryFn: async () => {
      const res = await apiFetch<{ success: true; data: ApiSpeakerLite[] }>("/speakers", {
        method: "GET",
      });
      return res.data;
    },
    retry: false,
  });

  const roomsQ = useQuery({
    queryKey: ["admin", "rooms-lite"],
    queryFn: async () => {
      const res = await apiFetch<{ success: true; data: ApiRoom[] }>("/rooms", { method: "GET" });
      return res.data;
    },
    retry: false,
  });

  const sessionQ = useQuery({
    queryKey: ["admin", "session", id],
    queryFn: async () => {
      const res = await apiFetch<{ success: true; data: ApiSession }>(`/sessions/${id}`, {
        method: "GET",
      });
      setForm({
        slug: res.data.slug,
        title: res.data.title,
        type: res.data.type ?? "talk",
        level: res.data.level ?? "",
        abstract: res.data.abstract ?? "",
      });
      setSelectedSpeakers(res.data.speakerIds ?? []);
      setSlot({
        roomId: res.data.roomId ?? "",
        startAt: epochToLocalInput(res.data.startsAtEpoch),
        endAt: epochToLocalInput(res.data.endsAtEpoch),
      });
      return res.data;
    },
    retry: false,
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      await apiFetch(`/sessions/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          slug: form.slug,
          title: form.title,
          type: form.type,
          level: form.level || null,
          abstract: form.abstract,
        }),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "session", id] }),
    onError: (e) => setError(e instanceof ApiClientError ? e.message : String(e)),
  });

  const speakersMut = useMutation({
    mutationFn: async () => {
      await apiFetch(`/sessions/${id}/speakers`, {
        method: "PATCH",
        body: JSON.stringify({ speakerIds: selectedSpeakers }),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "session", id] }),
    onError: (e) => setError(e instanceof ApiClientError ? e.message : String(e)),
  });

  const statusMut = useMutation({
    mutationFn: async (status: string) => {
      await apiFetch(`/sessions/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "session", id] }),
    onError: (e) => setError(e instanceof ApiClientError ? e.message : String(e)),
  });

  const slotMut = useMutation({
    mutationFn: async () => {
      await apiFetch(`/schedule/${id}/slot`, {
        method: "PATCH",
        body: JSON.stringify({
          roomId: slot.roomId || null,
          startsAt: slot.startAt ? new Date(slot.startAt).toISOString() : null,
          endsAt: slot.endAt ? new Date(slot.endAt).toISOString() : null,
        }),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "session", id] }),
    onError: (e) => setError(e instanceof ApiClientError ? e.message : String(e)),
  });

  if (sessionQ.isLoading) return <p className="text-ink-muted">Loading session…</p>;
  if (sessionQ.isError || !sessionQ.data) {
    return (
      <div>
        <h1 className="text-3xl font-bold">Session not found</h1>
        <Link href="/sessions" className="text-pg-blue text-sm hover:underline">
          ← Back to sessions
        </Link>
      </div>
    );
  }

  const s = sessionQ.data;
  return (
    <div className="w-full">
      <Link href="/sessions" className="text-pg-blue text-sm hover:underline">
        ← Sessions
      </Link>
      <div className="mt-2 flex items-center gap-3">
        <h1 className="text-3xl font-bold tracking-tight">{s.title}</h1>
        <span
          className={`admin-label rounded-sm border px-2 py-0.5 text-xs ${s.isDraft === 1 ? "border-pg-amber text-pg-amber" : "border-pg-blue text-pg-blue"}`}
        >
          {s.isDraft === 1 ? "Draft" : "Published"}
        </span>
      </div>
      <p className="text-ink-muted admin-label mt-1 text-xs">{humanizeStatus(s.type)}</p>

      {error && (
        <p role="alert" className="text-pg-amber mt-3 text-sm">
          {error}
        </p>
      )}

      <div className="card mt-6 max-w-2xl space-y-4 p-6">
        <label className="block">
          <span className="admin-label text-ink-muted text-xs uppercase">Session title</span>
          <input
            className="border-hairline bg-surface mt-1 w-full rounded-sm border px-3 py-2 text-sm"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
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
            <span className="admin-label text-ink-muted text-xs uppercase">Session type</span>
            <select
              className="border-hairline bg-surface mt-1 w-full rounded-sm border px-3 py-2 text-sm"
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
            >
              {[
                ["talk", "Talk"],
                ["keynote", "Keynote"],
                ["panel", "Panel"],
                ["break", "Break"],
                ["logistics", "Logistics"],
              ].map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block">
          <span className="admin-label text-ink-muted text-xs uppercase">Description</span>
          <textarea
            className="border-hairline bg-surface mt-1 w-full rounded-sm border px-3 py-2 text-sm"
            rows={4}
            value={form.abstract}
            onChange={(e) => setForm({ ...form, abstract: e.target.value })}
          />
        </label>
        <button
          onClick={() => saveMut.mutate()}
          disabled={saveMut.isPending}
          className="bg-pg-blue rounded-sm px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          Save content
        </button>
      </div>

      <div className="card mt-6 max-w-2xl space-y-4 p-6">
        <h2 className="text-lg font-bold">Speakers</h2>
        {(speakersQ.data ?? []).length === 0 ? (
          <p className="text-ink-muted text-sm">
            No speakers yet — add one on the Speakers page first.
          </p>
        ) : (
          <ul className="space-y-2">
            {(speakersQ.data ?? []).map((sp) => (
              <li key={sp.id}>
                <label className="border-hairline hover:bg-surface-raised flex cursor-pointer items-center gap-3 rounded-sm border px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedSpeakers.includes(sp.id)}
                    onChange={(e) =>
                      setSelectedSpeakers((prev) =>
                        e.target.checked ? [...prev, sp.id] : prev.filter((x) => x !== sp.id)
                      )
                    }
                    className="size-4 accent-[#336791]"
                  />
                  <span className="text-ink font-medium">{sp.name}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <button
          onClick={() => speakersMut.mutate()}
          disabled={speakersMut.isPending}
          className="bg-pg-blue rounded-sm px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          Save speakers
        </button>
      </div>

      <div className="card mt-6 max-w-2xl space-y-4 p-6">
        <h2 className="text-lg font-bold">Time & room</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="admin-label text-ink-muted text-xs uppercase">Room</span>
            <select
              value={slot.roomId}
              onChange={(e) => setSlot({ ...slot, roomId: e.target.value })}
              className="border-hairline bg-surface mt-1 w-full rounded-sm border px-3 py-2 text-sm"
            >
              <option value="">No room</option>
              {(roomsQ.data ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="admin-label text-ink-muted text-xs uppercase">Start</span>
            <input
              type="datetime-local"
              value={slot.startAt}
              onChange={(e) => setSlot({ ...slot, startAt: e.target.value })}
              className="border-hairline bg-surface mt-1 w-full rounded-sm border px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="admin-label text-ink-muted text-xs uppercase">End</span>
            <input
              type="datetime-local"
              value={slot.endAt}
              onChange={(e) => setSlot({ ...slot, endAt: e.target.value })}
              className="border-hairline bg-surface mt-1 w-full rounded-sm border px-3 py-2 text-sm"
            />
          </label>
        </div>
        <p className="text-ink-muted text-xs">
          Overlapping sessions in the same room are rejected automatically.
        </p>
        <button
          onClick={() => slotMut.mutate()}
          disabled={slotMut.isPending}
          className="bg-pg-blue rounded-sm px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          Save time & room
        </button>
      </div>

      <div className="card mt-6 max-w-2xl p-6">
        <h2 className="text-lg font-bold">Publishing</h2>
        <p className="text-ink-muted mt-1 text-sm">
          A session can only be published when all its speakers are published.
        </p>
        <div className="mt-3 flex gap-3">
          <button
            onClick={() => statusMut.mutate("published")}
            disabled={statusMut.isPending}
            className="bg-pg-blue rounded-sm px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Publish
          </button>
          <button
            onClick={() => statusMut.mutate("draft")}
            disabled={statusMut.isPending}
            className="border-hairline bg-surface-raised rounded-sm border px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            Move back to draft
          </button>
        </div>
      </div>
    </div>
  );
}
