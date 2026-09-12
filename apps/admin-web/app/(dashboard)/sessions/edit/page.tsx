"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, Suspense } from "react";
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

/** Unix seconds → "HH:MM" in Africa/Cairo (single-day event — time only). */
function epochToTimeInput(epoch: number | null | undefined): string {
  if (!epoch) return "";
  const d = new Date(epoch * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "HH:MM" + event date → unix seconds in Africa/Cairo. Returns null if incomplete. */
function timeToEpoch(date: string, time: string): number | null {
  if (!date || !time) return null;
  const [h, m] = time.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  // Africa/Cairo — Egypt observes DST (UTC+3) from late April to late October
  const iso = `${date}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+03:00`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/** Minutes since midnight for "HH:MM". */
function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function SessionDetailPageInner() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id") ?? "";
  const qc = useQueryClient();
  const [form, setForm] = useState({ slug: "", title: "", type: "talk", level: "", abstract: "" });
  const [selectedSpeakers, setSelectedSpeakers] = useState<string[]>([]);
  const [slot, setSlot] = useState({ roomId: "", startTime: "", endTime: "" });
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

  const settingsQ = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: async () => {
      const res = await apiFetch<{
        success: true;
        data: {
          date: string;
          dateDisplay?: string | null;
          startTime?: string | null;
          endTime?: string | null;
        };
      }>("/settings", { method: "GET" });
      return res.data;
    },
    retry: false,
  });

  const scheduleQ = useQuery({
    queryKey: ["admin", "schedule"],
    queryFn: async () => {
      const res = await apiFetch<{
        success: true;
        data: Array<{
          id: string;
          title: string;
          startsAtEpoch?: number | null;
          endsAtEpoch?: number | null;
          roomId?: string | null;
        }>;
      }>("/schedule", { method: "GET" });
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
        startTime: epochToTimeInput(res.data.startsAtEpoch),
        endTime: epochToTimeInput(res.data.endsAtEpoch),
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
      const eventDate = settingsQ.data?.date ?? "";
      const startsAtEpoch = timeToEpoch(eventDate, slot.startTime);
      const endsAtEpoch = timeToEpoch(eventDate, slot.endTime);
      await apiFetch(`/schedule/${id}/slot`, {
        method: "PATCH",
        body: JSON.stringify({
          roomId: slot.roomId || null,
          startsAtEpoch,
          endsAtEpoch,
        }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "session", id] });
      qc.invalidateQueries({ queryKey: ["admin", "schedule"] });
    },
    onError: (e) => setError(e instanceof ApiClientError ? e.message : String(e)),
  });

  // Smart conflict check — warn before saving if another session overlaps
  // the chosen room+time (the API also rejects with 409 as a hard guard).
  const conflict = (() => {
    if (!slot.roomId || !slot.startTime || !slot.endTime) return null;
    const eventDate = settingsQ.data?.date ?? "";
    const start = timeToEpoch(eventDate, slot.startTime);
    const end = timeToEpoch(eventDate, slot.endTime);
    if (!start || !end || end <= start) return null;
    const clash = (scheduleQ.data ?? []).find(
      (s) =>
        s.id !== id &&
        s.roomId === slot.roomId &&
        s.startsAtEpoch != null &&
        s.endsAtEpoch != null &&
        start < (s.endsAtEpoch as number) &&
        end > (s.startsAtEpoch as number)
    );
    return clash ?? null;
  })();

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
        <p className="text-ink-muted text-xs">
          {settingsQ.data?.dateDisplay || settingsQ.data?.date || "Event date"} ·{" "}
          {settingsQ.data?.startTime ?? "—"} – {settingsQ.data?.endTime ?? "—"} (
          {settingsQ.data?.startTime || settingsQ.data?.endTime
            ? "conference hours"
            : "set hours in Settings"}
          )
        </p>
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
            <span className="admin-label text-ink-muted text-xs uppercase">Start time</span>
            <input
              type="time"
              value={slot.startTime}
              min={settingsQ.data?.startTime ?? undefined}
              max={settingsQ.data?.endTime ?? undefined}
              onChange={(e) => setSlot({ ...slot, startTime: e.target.value })}
              className="border-hairline bg-surface mt-1 w-full rounded-sm border px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="admin-label text-ink-muted text-xs uppercase">End time</span>
            <input
              type="time"
              value={slot.endTime}
              min={settingsQ.data?.startTime ?? undefined}
              max={settingsQ.data?.endTime ?? undefined}
              onChange={(e) => setSlot({ ...slot, endTime: e.target.value })}
              className="border-hairline bg-surface mt-1 w-full rounded-sm border px-3 py-2 text-sm"
            />
          </label>
        </div>
        {(() => {
          const eventDate = settingsQ.data?.date ?? "";
          const start = timeToEpoch(eventDate, slot.startTime);
          const end = timeToEpoch(eventDate, slot.endTime);
          const startMin = settingsQ.data?.startTime
            ? timeToMinutes(settingsQ.data.startTime)
            : null;
          const endMax = settingsQ.data?.endTime ? timeToMinutes(settingsQ.data.endTime) : null;
          const startMinOfDay = slot.startTime ? timeToMinutes(slot.startTime) : null;
          const endMinOfDay = slot.endTime ? timeToMinutes(slot.endTime) : null;
          if (slot.startTime && slot.endTime && start && end && end <= start) {
            return (
              <p role="alert" className="text-pg-amber text-xs">
                End time must be after start time.
              </p>
            );
          }
          if (startMinOfDay != null && startMin != null && startMinOfDay < startMin) {
            return (
              <p role="alert" className="text-pg-amber text-xs">
                Start is before the conference begins ({settingsQ.data?.startTime}).
              </p>
            );
          }
          if (endMinOfDay != null && endMax != null && endMinOfDay > endMax) {
            return (
              <p role="alert" className="text-pg-amber text-xs">
                End is after the conference ends ({settingsQ.data?.endTime}).
              </p>
            );
          }
          return null;
        })()}
        {conflict && (
          <p role="alert" className="text-pg-amber text-xs">
            Conflict: “{conflict.title}” already occupies this room at that time.
          </p>
        )}
        <p className="text-ink-muted text-xs">
          Times are on the event day only. Overlapping sessions in the same room are rejected
          automatically.
        </p>
        <button
          onClick={() => slotMut.mutate()}
          disabled={slotMut.isPending || Boolean(conflict)}
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

export default function SessionDetailPage() {
  return (
    <Suspense fallback={<div className="text-ink-muted p-8 text-sm">Loading…</div>}>
      <SessionDetailPageInner />
    </Suspense>
  );
}
