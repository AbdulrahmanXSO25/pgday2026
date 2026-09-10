"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { apiFetch, ApiClientError } from "@/lib/api";
import { humanizeStatus } from "@/lib/format";

type CfpSubmission = {
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
  submitterBio?: string | null;
  submitter_bio?: string | null;
  eventId?: string;
  event_id?: string;
  createdAt?: number;
};

type CfpSpeaker = {
  id: string;
  submissionId?: string;
  submission_id?: string;
  name: string;
  email: string;
  bio?: string | null;
  company?: string | null;
  role?: string | null;
  isPrimary?: number;
  is_primary?: number;
};

type CfpReview = {
  id: string;
  submissionId?: string;
  submission_id?: string;
  reviewerId?: string | null;
  reviewer_id?: string | null;
  score?: number | null;
  comment?: string | null;
  statusFrom?: string | null;
  status_from?: string | null;
  statusTo?: string | null;
  status_to?: string | null;
  createdAt?: number;
  created_at?: number;
};

type DetailResponse = {
  submission: CfpSubmission;
  speakers: CfpSpeaker[];
  reviews: CfpReview[];
};

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

export default function CfpDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const qc = useQueryClient();
  const [nextStatus, setNextStatus] = useState<string>("");
  const [comment, setComment] = useState<string>("");
  const [score, setScore] = useState<string>("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const detailQ = useQuery({
    queryKey: ["admin", "cfp", id],
    queryFn: async () => {
      const res = await apiFetch<{ success: true; data: DetailResponse }>(
        `/cfp/submissions/${id}`,
        { method: "GET" }
      );
      return res.data;
    },
    retry: false,
  });

  const transitionMut = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const res = await apiFetch<{ success: true; data: CfpSubmission }>(`/cfp/submissions/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "cfp", id] });
      qc.invalidateQueries({ queryKey: ["admin", "cfp"] });
      setActionError(null);
      setActionSuccess("Status updated.");
      setNextStatus("");
      setComment("");
      setScore("");
    },
    onError: (e: unknown) => {
      const msg =
        e instanceof ApiClientError
          ? `${e.code}: ${e.message}`
          : e instanceof Error
            ? e.message
            : "Transition failed";
      setActionError(msg);
      setActionSuccess(null);
    },
  });

  const reviewMut = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const res = await apiFetch<{ success: true; data: CfpReview }>(
        `/cfp/submissions/${id}/reviews`,
        {
          method: "POST",
          body: JSON.stringify(payload),
        }
      );
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "cfp", id] });
      setActionError(null);
      setActionSuccess("Review added.");
      setComment("");
      setScore("");
    },
    onError: (e: unknown) => {
      const msg =
        e instanceof ApiClientError
          ? `${e.code}: ${e.message}`
          : e instanceof Error
            ? e.message
            : "Review failed";
      setActionError(msg);
      setActionSuccess(null);
    },
  });

  const promoteMut = useMutation({
    mutationFn: async () => {
      const res = await apiFetch<{
        success: true;
        data: { session: Record<string, unknown>; speakers: unknown[]; alreadyPromoted: boolean };
      }>(`/cfp/submissions/${id}/promote`, { method: "POST", body: JSON.stringify({}) });
      return res.data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["admin", "cfp", id] });
      setActionError(null);
      setActionSuccess(
        data.alreadyPromoted
          ? "Already promoted — draft exists."
          : "Promoted to draft speakers + session."
      );
    },
    onError: (e: unknown) => {
      const msg =
        e instanceof ApiClientError
          ? `${e.code}: ${e.message}`
          : e instanceof Error
            ? e.message
            : "Promote failed";
      setActionError(msg);
      setActionSuccess(null);
    },
  });

  if (detailQ.isLoading) {
    return <p className="admin-label text-ink-muted text-sm">Loading submission…</p>;
  }
  if (detailQ.isError) {
    return (
      <div>
        <p role="alert" className="text-sm text-red-600">
          {(detailQ.error as Error).message}
        </p>
        <Link href="/cfp" className="text-pg-blue mt-2 inline-block text-sm hover:underline">
          ← Back to CFP
        </Link>
      </div>
    );
  }

  const data = detailQ.data!;
  const submission = data.submission;
  const speakers = data.speakers ?? [];
  const reviews = data.reviews ?? [];
  const status = submission.status;

  // Valid next statuses per state machine
  const validNext: string[] =
    status === "submitted"
      ? ["under_review"]
      : status === "under_review"
        ? ["accepted", "rejected"]
        : [];

  return (
    <div className="w-full">
      <Link href="/cfp" className="admin-label text-pg-blue text-xs hover:underline">
        ← All proposals
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight">{submission.title}</h1>
        <span
          className={`admin-label inline-flex rounded-sm px-2 py-1 text-xs font-medium ${statusBadge(status)}`}
        >
          {humanizeStatus(status)}
        </span>
      </div>
      <p className="text-ink-muted mt-1 text-sm leading-relaxed">{submission.abstract}</p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="card p-4">
          <h2 className="text-sm font-semibold">Submission</h2>
          <dl className="admin-label text-ink-muted mt-2 space-y-1 text-xs">
            <div className="flex justify-between gap-4">
              <dt>Submitter</dt>
              <dd className="text-ink font-medium">
                {submission.submitterName ?? submission.submitter_name}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Email</dt>
              <dd className="text-ink">
                {submission.submitterEmail ?? submission.submitter_email}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Track</dt>
              <dd>{submission.track ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Level</dt>
              <dd>{submission.level ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>ID</dt>
              <dd className="truncate">{submission.id.slice(0, 12)}…</dd>
            </div>
          </dl>
          {submission.submitterBio || submission.submitter_bio ? (
            <p className="text-ink-muted mt-3 text-sm leading-relaxed">
              {submission.submitterBio ?? submission.submitter_bio}
            </p>
          ) : null}
        </div>

        <div className="card p-4">
          <h2 className="text-sm font-semibold">Speakers</h2>
          <ul className="divide-hairline mt-2 divide-y">
            {speakers.map((sp) => (
              <li key={sp.id} className="py-2">
                <p className="text-sm font-medium">
                  {sp.name}{" "}
                  {(sp.isPrimary ?? sp.is_primary) ? (
                    <span className="admin-label bg-pg-blue rounded-sm px-1 py-0.5 text-[10px] text-white">
                      Main contact
                    </span>
                  ) : null}
                </p>
                <p className="admin-label text-ink-muted text-xs">{sp.email}</p>
                {sp.bio ? (
                  <p className="text-ink-muted mt-1 line-clamp-2 text-xs">{sp.bio}</p>
                ) : null}
              </li>
            ))}
            {speakers.length === 0 ? (
              <li className="admin-label text-ink-muted py-2 text-xs">No speakers listed.</li>
            ) : null}
          </ul>
        </div>
      </div>

      <div className="card mt-6 p-5">
        <h2 className="text-sm font-semibold">Review this proposal</h2>
        <p className="admin-label text-ink-muted mt-1 text-xs">
          Move it forward: submitted → under review → accepted or rejected
        </p>
        {validNext.length === 0 ? (
          <p className="admin-label text-ink-muted mt-3 text-xs">
            No further steps available — this proposal is {humanizeStatus(status).toLowerCase()}.
          </p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setActionError(null);
              setActionSuccess(null);
              if (!nextStatus) {
                setActionError("Select a target status.");
                return;
              }
              const payload: Record<string, unknown> = { status: nextStatus };
              if (comment.trim()) payload.comment = comment.trim();
              if (score.trim()) {
                const n = Number(score.trim());
                if (!Number.isInteger(n) || n < 1 || n > 5) {
                  setActionError("Score must be integer 1-5");
                  return;
                }
                payload.score = n;
              }
              transitionMut.mutate(payload);
            }}
            className="mt-3 grid gap-3 sm:grid-cols-2"
          >
            <select
              value={nextStatus}
              onChange={(e) => setNextStatus(e.target.value)}
              className="border-hairline bg-surface rounded-sm border px-3 py-2 text-sm"
              aria-label="Next step"
            >
              <option value="">Choose the next step…</option>
              {validNext.map((s) => (
                <option key={s} value={s}>
                  {humanizeStatus(s)}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              max={5}
              aria-label="Score from 1 to 5 (optional)"
              placeholder="Score 1–5 (optional)"
              value={score}
              onChange={(e) => setScore(e.target.value)}
              className="border-hairline bg-surface rounded-sm border px-3 py-2 text-sm"
            />
            <textarea
              aria-label="Review comment (optional)"
              placeholder="Add a note for the other organizers (optional)"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="border-hairline bg-surface rounded-sm border px-3 py-2 text-sm sm:col-span-2"
              rows={2}
            />
            <div className="flex items-center gap-3 sm:col-span-2">
              <button
                type="submit"
                disabled={transitionMut.isPending}
                className="bg-pg-blue hover:bg-pg-blue-dark inline-flex rounded-sm px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {transitionMut.isPending ? "Updating…" : "Transition"}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!comment.trim() && !score.trim()) {
                    setActionError("Comment or score required for standalone review");
                    return;
                  }
                  const payload: Record<string, unknown> = {};
                  if (comment.trim()) payload.comment = comment.trim();
                  if (score.trim()) {
                    const n = Number(score.trim());
                    payload.score = n;
                  }
                  reviewMut.mutate(payload);
                }}
                disabled={reviewMut.isPending}
                className="border-hairline bg-surface inline-flex rounded-sm border px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                {reviewMut.isPending ? "Saving…" : "Add review only"}
              </button>
            </div>
          </form>
        )}
        {actionError ? (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {actionError}
          </p>
        ) : null}
        {actionSuccess ? (
          <p role="status" className="mt-3 text-sm text-emerald-700">
            {actionSuccess}
          </p>
        ) : null}
        <p className="admin-label text-ink-muted mt-2 text-xs">
          Every review and decision is saved to the history log.
        </p>
      </div>

      <div className="card mt-6 p-5">
        <h2 className="text-sm font-semibold">Add to the program</h2>
        <p className="admin-label text-ink-muted mt-1 text-xs">
          Turns an accepted proposal into draft speaker and session entries you can edit before
          publishing.
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => promoteMut.mutate()}
            disabled={promoteMut.isPending || status !== "accepted"}
            className="bg-pg-blue hover:bg-pg-blue-dark inline-flex rounded-sm px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            title={status !== "accepted" ? "Only accepted submissions can be promoted" : undefined}
          >
            {promoteMut.isPending ? "Promoting…" : "Promote to draft"}
          </button>
          {status !== "accepted" ? (
            <span className="admin-label text-ink-muted self-center text-xs">
              Requires accepted status (current: {status})
            </span>
          ) : null}
        </div>
        {promoteMut.isError ? (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {(promoteMut.error as Error).message}
          </p>
        ) : null}
        {promoteMut.isSuccess ? (
          <p role="status" className="mt-3 text-sm text-emerald-700">
            {(promoteMut.data as { alreadyPromoted?: boolean })?.alreadyPromoted
              ? "Already added."
              : "Done."}{" "}
            The draft speaker and session entries are ready for editing.
          </p>
        ) : null}
      </div>

      <div className="mt-6">
        <h2 className="admin-label text-ink-muted mb-2 text-xs uppercase">reviews (cfp_reviews)</h2>
        {reviews.length === 0 ? (
          <p className="admin-label text-ink-muted text-sm">No reviews yet.</p>
        ) : (
          <ul className="border-hairline bg-surface divide-hairline divide-y border">
            {reviews.map((r) => (
              <li key={r.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  {r.statusFrom || r.status_from ? (
                    <span className="admin-label bg-surface-raised border-hairline rounded-sm border px-2 py-0.5 text-xs">
                      {(r.statusFrom ?? r.status_from) as string} →{" "}
                      {(r.statusTo ?? r.status_to) as string}
                    </span>
                  ) : (
                    <span className="admin-label bg-surface-raised border-hairline rounded-sm border px-2 py-0.5 text-xs">
                      comment
                    </span>
                  )}
                  {r.score != null ? (
                    <span className="admin-label text-ink-muted text-xs">score {r.score}</span>
                  ) : null}
                  <span className="admin-label text-ink-muted ml-auto text-xs">
                    {(r.createdAt ?? r.created_at)
                      ? new Date(((r.createdAt ?? r.created_at) as number) * 1000).toLocaleString()
                      : ""}
                  </span>
                </div>
                {r.comment ? <p className="mt-1 text-sm leading-relaxed">{r.comment}</p> : null}
                <p className="admin-label text-ink-muted mt-1 text-xs">
                  id {r.id.slice(0, 8)} · reviewer {r.reviewerId ?? r.reviewer_id ?? "—"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
