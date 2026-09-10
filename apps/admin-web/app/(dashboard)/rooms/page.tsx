"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch, ApiClientError } from "@/lib/api";

/**
 * Admin Rooms page — FK only per §24 note, no multi-track UI.
 * Minimal CRUD reusing same styling as other admin pages.
 */

type ApiRoom = {
  id: string;
  slug: string;
  name: string;
  capacity?: number | null;
  sortOrder?: number | null;
  sort_order?: number | null;
};

export default function RoomsPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ slug: "", name: "", capacity: "" });
  const [error, setError] = useState<string | null>(null);

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
      const res = await apiFetch<{ success: true; data: ApiRoom }>("/rooms", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "rooms"] });
      setForm({ slug: "", name: "", capacity: "" });
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
    if (!form.slug.trim() || !form.name.trim()) {
      setError("Slug and name are required.");
      return;
    }
    const cap = form.capacity.trim() ? Number(form.capacity.trim()) : undefined;
    if (form.capacity.trim() && (!Number.isFinite(cap as number) || (cap as number) <= 0)) {
      setError("Capacity must be a positive integer.");
      return;
    }
    createMut.mutate({
      slug: form.slug.trim().toLowerCase(),
      name: form.name.trim(),
      capacity: cap,
    });
  };

  return (
    <div className="w-full">
      <p className="admin-label text-pg-blue mb-2">Schedule</p>
      <h1 className="text-2xl font-bold tracking-tight">Rooms</h1>
      <p className="text-ink-muted mt-1 text-sm">
        Rooms host the sessions on the schedule. The event runs a single track.
      </p>

      <div className="card mt-6 p-5">
        <h2 className="text-sm font-semibold">Create room</h2>
        <form onSubmit={onCreate} className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="admin-label text-ink-muted text-xs uppercase">URL slug</span>
            <input
              placeholder="e.g. main-hall"
              value={form.slug}
              onChange={(e) => setForm((s) => ({ ...s, slug: e.target.value }))}
              className="border-hairline bg-surface mt-1 w-full rounded-sm border px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="admin-label text-ink-muted text-xs uppercase">Name</span>
            <input
              placeholder="e.g. Main Hall"
              value={form.name}
              onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
              className="border-hairline bg-surface mt-1 w-full rounded-sm border px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="admin-label text-ink-muted text-xs uppercase">
              Capacity <span className="font-normal tracking-normal normal-case">(optional)</span>
            </span>
            <input
              placeholder="e.g. 300"
              value={form.capacity}
              onChange={(e) => setForm((s) => ({ ...s, capacity: e.target.value }))}
              className="border-hairline bg-surface mt-1 w-full rounded-sm border px-3 py-2 text-sm"
            />
          </label>
          <div className="sm:col-span-3">
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

      <div className="mt-6">
        {roomsQ.isLoading ? (
          <p className="admin-label text-ink-muted text-sm">Loading…</p>
        ) : roomsQ.isError ? (
          <p role="alert" className="text-sm text-red-600">
            {(roomsQ.error as Error).message}
          </p>
        ) : (
          <ul className="border-hairline bg-surface divide-hairline divide-y border">
            {(roomsQ.data ?? []).map((room) => (
              <li key={room.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-semibold">{room.name}</p>
                  <p className="admin-label text-ink-muted text-xs">
                    /{room.slug}
                    {room.capacity ? ` · Seats ${room.capacity}` : ""}
                  </p>
                </div>
                <span className="admin-label bg-surface-raised border-hairline rounded-sm border px-2 py-1 text-xs">
                  Position {room.sortOrder ?? room.sort_order ?? 0}
                </span>
              </li>
            ))}
            {(roomsQ.data ?? []).length === 0 ? (
              <li className="text-ink-muted px-4 py-3 text-sm">
                No rooms yet. The main hall is created automatically.
              </li>
            ) : null}
          </ul>
        )}
      </div>
    </div>
  );
}
