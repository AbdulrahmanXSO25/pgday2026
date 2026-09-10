"use client";

import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { apiFetch, ApiClientError } from "@/lib/api";
import { humanizeStatus } from "@/lib/format";

/**
 * Admin Sessions + Schedule page — reuses schedule-row styling file-by-file (simplified)
 * Rooms FK only, no multi-track UI; overlap → 409 surfaced.
 */

type ApiSession = {
  id: string;
  slug: string;
  title: string;
  type: string;
  level?: string | null;
  abstract?: string | null;
  roomId?: string | null;
  room_id?: string | null;
  startsAt?: string | null;
  starts_at?: string | null;
  endsAt?: string | null;
  ends_at?: string | null;
  startsAtEpoch?: number | null;
  starts_at_epoch?: number | null;
  endsAtEpoch?: number | null;
  ends_at_epoch?: number | null;
  speakerIds?: string[];
};

type ApiRoom = {
  id: string;
  slug: string;
  name: string;
  capacity?: number | null;
};

export default function SessionsPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    slug: "",
    title: "",
    type: "talk" as string,
    roomId: "",
    startsAt: "",
    endsAt: "",
    speakerIdsRaw: "",
  });
  const [error, setError] = useState<string | null>(null);

  const sessionsQ = useQuery({
    queryKey: ["admin", "sessions"],
    queryFn: async () => {
      const res = await apiFetch<{ success: true; data: ApiSession[] }>("/sessions", {
        method: "GET",
      });
      return res.data;
    },
    retry: false,
  });

  const roomsQ = useQuery({
    queryKey: ["admin", "rooms"],
    queryFn: async () => {
      const res = await apiFetch<{ success: true; data: ApiRoom[] }>("/rooms", { method: "GET" });
      return res.data;
    },
    retry: false,
  });

  const createMut = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const res = await apiFetch<{ success: true; data: ApiSession }>("/sessions", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "sessions"] });
      setError(null);
    },
    onError: (e: unknown) => {
      const msg =
        e instanceof ApiClientError
          ? `${e.code}: ${e.message}`
          : e instanceof Error
            ? e.message
            : "Create failed";
      setError(msg);
    },
  });

  const onCreate = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.slug.trim() || !form.title.trim()) {
      setError("Slug and title are required.");
      return;
    }
    if (form.startsAt && !form.endsAt) {
      setError("Both startsAt and endsAt must be provided together.");
      return;
    }
    const speakerIds = form.speakerIdsRaw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const payload: Record<string, unknown> = {
      slug: form.slug.trim().toLowerCase(),
      title: form.title.trim(),
      type: form.type,
      roomId: form.roomId.trim() || undefined,
      speakerIds: speakerIds.length > 0 ? speakerIds : undefined,
    };
    if (form.startsAt && form.endsAt) {
      payload.startsAt = new Date(form.startsAt).toISOString();
      payload.endsAt = new Date(form.endsAt).toISOString();
    }

    createMut.mutate(payload);
  };

  return (
    <div className="w-full">
      <p className="admin-label text-pg-blue mb-2">Content</p>
      <h1 className="text-2xl font-bold tracking-tight">Sessions</h1>
      <p className="text-ink-muted mt-1 text-sm">
        Manage talks, breaks and logistics. Times and rooms can be refined on each session&apos;s
        page — overlapping bookings are rejected automatically.
      </p>

      <div className="card mt-6 p-5">
        <h2 className="text-sm font-semibold">Create session</h2>
        <form onSubmit={onCreate} className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="admin-label text-ink-muted text-xs uppercase">URL slug</span>
            <input
              aria-label="Session slug"
              placeholder="e.g. indexing-strategies"
              value={form.slug}
              onChange={(e) => setForm((s) => ({ ...s, slug: e.target.value }))}
              className="border-hairline bg-surface mt-1 w-full rounded-sm border px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="admin-label text-ink-muted text-xs uppercase">Title</span>
            <input
              aria-label="Session title"
              placeholder="e.g. Indexing strategies that scale"
              value={form.title}
              onChange={(e) => setForm((s) => ({ ...s, title: e.target.value }))}
              className="border-hairline bg-surface mt-1 w-full rounded-sm border px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="admin-label text-ink-muted text-xs uppercase">Type</span>
            <select
              aria-label="Session type"
              value={form.type}
              onChange={(e) => setForm((s) => ({ ...s, type: e.target.value }))}
              className="border-hairline bg-surface mt-1 w-full rounded-sm border px-3 py-2 text-sm"
            >
              <option value="talk">Talk</option>
              <option value="keynote">Keynote</option>
              <option value="panel">Panel</option>
              <option value="break">Break</option>
              <option value="logistics">Logistics</option>
            </select>
          </label>
          <label className="block">
            <span className="admin-label text-ink-muted text-xs uppercase">Room</span>
            <select
              aria-label="Room"
              value={form.roomId}
              onChange={(e) => setForm((s) => ({ ...s, roomId: e.target.value }))}
              className="border-hairline bg-surface mt-1 w-full rounded-sm border px-3 py-2 text-sm"
            >
              <option value="">No room yet</option>
              {(roomsQ.data ?? []).map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="admin-label text-ink-muted text-xs uppercase">Start</span>
            <input
              aria-label="Starts at"
              type="datetime-local"
              value={form.startsAt}
              onChange={(e) => setForm((s) => ({ ...s, startsAt: e.target.value }))}
              className="border-hairline bg-surface mt-1 w-full rounded-sm border px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="admin-label text-ink-muted text-xs uppercase">End</span>
            <input
              aria-label="Ends at"
              type="datetime-local"
              value={form.endsAt}
              onChange={(e) => setForm((s) => ({ ...s, endsAt: e.target.value }))}
              className="border-hairline bg-surface mt-1 w-full rounded-sm border px-3 py-2 text-sm"
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="admin-label text-ink-muted text-xs uppercase">
              Speakers{" "}
              <span className="font-normal tracking-normal normal-case">
                (assign more on the session page)
              </span>
            </span>
            <input
              aria-label="Speaker IDs, comma-separated"
              placeholder="You can also assign speakers on the session page"
              value={form.speakerIdsRaw}
              onChange={(e) => setForm((s) => ({ ...s, speakerIdsRaw: e.target.value }))}
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
            <p className="admin-label text-ink-muted mt-2 text-xs">
              Tip: set times on the session page for a friendlier picker.
            </p>
          </div>
        </form>
      </div>

      <div className="mt-6">
        <h2 className="admin-label text-ink-muted mb-2 text-xs uppercase">All sessions</h2>
        {sessionsQ.isLoading ? (
          <p className="admin-label text-ink-muted text-sm">Loading…</p>
        ) : sessionsQ.isError ? (
          <p role="alert" className="text-sm text-red-600">
            {(sessionsQ.error as Error).message}
          </p>
        ) : sessionsQ.data?.length === 0 ? (
          <p className="admin-label text-ink-muted text-sm">No sessions yet.</p>
        ) : (
          <ol className="divide-hairline border-hairline bg-surface divide-y border">
            {(sessionsQ.data ?? []).map((row) => (
              <li key={row.id} className="flex items-center justify-between px-4 py-3">
                <div className="min-w-0">
                  <Link
                    href={`/sessions/${row.id}`}
                    className="text-sm font-semibold hover:underline"
                  >
                    {row.title}
                  </Link>
                  <p className="admin-label text-ink-muted text-xs">
                    {humanizeStatus(row.type)}
                    {(() => {
                      const roomName = (roomsQ.data ?? []).find(
                        (r) => r.id === (row.roomId ?? row.room_id)
                      )?.name;
                      return roomName ? ` · ${roomName}` : "";
                    })()}
                    {row.startsAt || row.starts_at
                      ? ` · ${row.startsAt ?? row.starts_at} → ${row.endsAt ?? row.ends_at}`
                      : ""}
                  </p>
                </div>
                <span className="admin-label bg-surface-raised border-hairline rounded-sm border px-2 py-1 text-xs">
                  {(row.speakerIds ?? []).length === 1
                    ? "1 speaker"
                    : `${(row.speakerIds ?? []).length} speakers`}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="mt-8">
        <h2 className="admin-label text-ink-muted mb-2 text-xs uppercase">Rooms</h2>
        {roomsQ.isLoading ? (
          <p className="admin-label text-ink-muted text-sm">Loading rooms…</p>
        ) : roomsQ.isError ? (
          <p className="admin-label text-ink-muted text-sm">{(roomsQ.error as Error).message}</p>
        ) : (
          <ul className="border-hairline bg-surface divide-hairline divide-y border">
            {(roomsQ.data ?? []).map((room) => (
              <li key={room.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="font-medium">{room.name}</span>
                <span className="admin-label text-ink-muted text-xs">
                  {room.capacity ? `Seats ${room.capacity}` : "No capacity set"}
                </span>
              </li>
            ))}
            {(roomsQ.data ?? []).length === 0 ? (
              <li className="text-ink-muted px-4 py-3 text-sm">No rooms.</li>
            ) : null}
          </ul>
        )}
      </div>
    </div>
  );
}
