"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { humanizeStatus } from "@/lib/format";

/**
 * Schedule — single-track vertical timeline (§22.3).
 * Sessions ordered by startsAtEpoch; room + speaker conflicts are enforced
 * server-side on slot PATCH (409). Multi-room ready via schema, single-track UI.
 */

type ApiSession = {
  id: string;
  slug: string;
  title: string;
  type: string;
  roomId?: string | null;
  startsAtEpoch?: number | null;
  endsAtEpoch?: number | null;
  speakerIds?: string[];
  status?: string;
};

export default function SchedulePage() {
  const scheduleQ = useQuery({
    queryKey: ["admin", "schedule"],
    queryFn: async () => {
      const res = await apiFetch<{ success: true; data: ApiSession[] }>("/schedule", {
        method: "GET",
      });
      return res.data;
    },
    retry: false,
  });

  if (scheduleQ.isLoading) return <p className="text-ink-muted">Loading timeline…</p>;
  if (scheduleQ.isError) return <p className="text-pg-amber">Failed to load schedule.</p>;

  const rows = [...(scheduleQ.data ?? [])].sort(
    (a, b) => (a.startsAtEpoch ?? 0) - (b.startsAtEpoch ?? 0)
  );
  const fmt = (epoch?: number | null) =>
    epoch
      ? new Date(epoch * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
      : "—";

  return (
    <div className="w-full">
      <h1 className="text-3xl font-bold tracking-tight">Schedule</h1>
      <p className="text-ink-muted mt-2 max-w-xl text-sm">
        The day&apos;s timeline, in order. Select a session to change its time or room — overlapping
        sessions are rejected automatically.
      </p>
      <ol className="mt-6 max-w-2xl space-y-2">
        {rows.map((s) => (
          <li key={s.id}>
            <Link
              href={`/sessions/${s.id}`}
              className="card hover:border-pg-blue flex items-baseline gap-4 rounded-sm border p-4 transition-colors"
            >
              <span className="admin-label text-pg-blue w-24 shrink-0 text-xs">
                {fmt(s.startsAtEpoch)} – {fmt(s.endsAtEpoch)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-ink truncate text-sm font-semibold">{s.title}</p>
                <p className="admin-label text-ink-muted text-[11px]">
                  {humanizeStatus(s.type)} ·{" "}
                  {(s.speakerIds ?? []).length === 1
                    ? "1 speaker"
                    : `${s.speakerIds?.length ?? 0} speakers`}
                </p>
              </div>
              <span
                className={`admin-label text-[11px] ${s.status === "published" ? "text-pg-blue" : "text-pg-amber"}`}
              >
                {humanizeStatus(s.status ?? "draft")}
              </span>
            </Link>
          </li>
        ))}
      </ol>
      {rows.length === 0 && (
        <p className="text-ink-muted mt-4 text-sm">No sessions yet — create one in Sessions.</p>
      )}
    </div>
  );
}
