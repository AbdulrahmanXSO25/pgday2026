"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import Link from "next/link";
import { apiFetch, ApiClientError } from "@/lib/api";
import { humanizeStatus } from "@/lib/format";

/**
 * Admin CFP list — §19-21
 * Lists all CFP submissions with filters (status, search), requires cfp:READ.
 * Each row links to detail for review + promotion.
 */

type ApiCfpSubmission = {
  id: string;
  title: string;
  abstract: string;
  track?: string | null;
  level?: string | null;
  status: string;
  submitterName: string;
  submitter_name?: string;
  submitterEmail: string;
  submitter_email?: string;
  eventId?: string;
  event_id?: string;
  createdAt?: number;
  created_at?: number;
  updatedAt?: number;
};

function formatDate(epoch?: number | null): string {
  if (!epoch) return "—";
  try {
    return new Date(epoch * 1000).toLocaleDateString("en-CA", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return String(epoch);
  }
}

function statusBadge(status: string): string {
  switch (status) {
    case "submitted":
      return "bg-surface-raised border-hairline border text-ink-muted";
    case "under_review":
      return "bg-amber-50 border-amber-200 text-amber-800 border";
    case "accepted":
      return "bg-emerald-50 border-emerald-200 text-emerald-800 border";
    case "rejected":
      return "bg-red-50 border-red-200 text-red-700 border";
    default:
      return "bg-surface-raised border-hairline border text-ink-muted";
  }
}

export default function CfpPage() {
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [searchInput, setSearchInput] = useState<string>("");

  const queryKey = ["admin", "cfp", { status: statusFilter, search }];

  const cfpQ = useQuery({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (search) params.set("search", search);
      params.set("limit", "100");
      const qs = params.toString() ? `?${params.toString()}` : "";
      const res = await apiFetch<{ success: true; data: ApiCfpSubmission[] }>(
        `/cfp/submissions${qs}`,
        { method: "GET" }
      );
      return res.data;
    },
    retry: false,
  });

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput.trim());
  };

  return (
    <div className="w-full">
      <p className="admin-label text-pg-blue mb-2">Call for papers</p>
      <h1 className="text-2xl font-bold tracking-tight">Talk proposals</h1>
      <p className="text-ink-muted mt-1 text-sm">
        Review submitted talks, then accept the best ones — accepted talks become draft speakers and
        sessions.
      </p>

      <div className="card mt-6 p-4">
        <form onSubmit={onSearch} className="flex flex-wrap gap-3">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border-hairline bg-surface rounded-sm border px-3 py-2 text-sm"
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            <option value="submitted">Submitted</option>
            <option value="under_review">Under review</option>
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
          </select>
          <input
            aria-label="Search by title, email or name"
            placeholder="Search title, email or name"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="border-hairline bg-surface min-w-[220px] flex-1 rounded-sm border px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="bg-pg-blue hover:bg-pg-blue-dark rounded-sm px-4 py-2 text-sm font-semibold text-white"
          >
            Filter
          </button>
          {(statusFilter || search) && (
            <button
              type="button"
              onClick={() => {
                setStatusFilter("");
                setSearch("");
                setSearchInput("");
              }}
              className="border-hairline bg-surface rounded-sm border px-4 py-2 text-sm"
            >
              Clear
            </button>
          )}
        </form>
        <p className="admin-label text-ink-muted mt-2 text-xs">Newest submissions first</p>
      </div>

      <div className="mt-6">
        {cfpQ.isLoading ? (
          <p className="admin-label text-ink-muted text-sm">Loading…</p>
        ) : cfpQ.isError ? (
          <p role="alert" className="text-sm text-red-600">
            {(cfpQ.error as Error).message}
            {cfpQ.error instanceof ApiClientError && cfpQ.error.status === 403
              ? " — you don't have access to proposals"
              : ""}
          </p>
        ) : (cfpQ.data?.length ?? 0) === 0 ? (
          <p className="admin-label text-ink-muted text-sm">No submissions yet.</p>
        ) : (
          <div className="border-hairline bg-surface overflow-hidden rounded-sm border">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-raised border-hairline border-b text-left">
                  <tr className="admin-label text-ink-muted text-xs">
                    <th className="px-4 py-2 font-medium">Title</th>
                    <th className="px-4 py-2 font-medium">Submitter</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Track</th>
                    <th className="px-4 py-2 font-medium">Created</th>
                    <th className="px-4 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody className="divide-hairline divide-y">
                  {(cfpQ.data ?? []).map((row) => (
                    <tr key={row.id} className="hover:bg-surface-raised/50">
                      <td className="px-4 py-3">
                        <p className="leading-tight font-semibold">{row.title}</p>
                        <p className="admin-label text-ink-muted line-clamp-1 text-xs">
                          {row.abstract.slice(0, 80)}…
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium">{row.submitterName ?? row.submitter_name}</p>
                        <p className="admin-label text-ink-muted text-xs">
                          {row.submitterEmail ?? row.submitter_email}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`admin-label inline-flex rounded-sm px-2 py-1 text-xs font-medium ${statusBadge(row.status)}`}
                        >
                          {humanizeStatus(row.status)}
                        </span>
                      </td>
                      <td className="admin-label text-ink-muted px-4 py-3 text-xs">
                        {row.track ?? "—"}
                      </td>
                      <td className="admin-label text-ink-muted px-4 py-3 text-xs">
                        {formatDate((row.createdAt as number) ?? (row.created_at as number))}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/cfp/detail?id=${row.id}`}
                          className="text-pg-blue font-medium hover:underline"
                        >
                          Review →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
