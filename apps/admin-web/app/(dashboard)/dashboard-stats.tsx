"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

type Counts = {
  speakers: number;
  sessions: number;
  sponsors: number;
  registrations: number;
  cfp: number;
  publications: number;
};

async function count(path: string): Promise<number> {
  try {
    const res = await apiFetch<{ success: true; data: unknown[]; meta?: { count?: number } }>(
      path,
      { method: "GET" }
    );
    if (typeof res.meta?.count === "number") return res.meta.count;
    return Array.isArray(res.data) ? res.data.length : 0;
  } catch {
    return 0;
  }
}

export function DashboardStats() {
  const statsQ = useQuery({
    queryKey: ["admin", "stats"],
    queryFn: async (): Promise<Counts> => {
      const [speakers, sessions, sponsors, registrations, cfp, publications] = await Promise.all([
        count("/speakers"),
        count("/sessions"),
        count("/sponsors"),
        count("/registrations"),
        count("/cfp/submissions"),
        count("/publish"),
      ]);
      return { speakers, sessions, sponsors, registrations, cfp, publications };
    },
    retry: false,
    refetchInterval: 30_000,
  });

  const s = statsQ.data;
  const items: Array<[string, number | undefined]> = [
    ["Speakers", s?.speakers],
    ["Sessions", s?.sessions],
    ["Sponsors", s?.sponsors],
    ["Registrations", s?.registrations],
    ["CFP submissions", s?.cfp],
    ["Publications", s?.publications],
  ];

  return (
    <div className="mt-6 grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-3">
      {items.map(([label, value]) => (
        <div key={label} className="card rounded-sm border p-4">
          <p className="admin-label text-ink-muted text-xs uppercase">{label}</p>
          <p className="text-pg-blue mt-1 text-2xl font-bold">
            {value === undefined ? "…" : value}
          </p>
        </div>
      ))}
    </div>
  );
}
