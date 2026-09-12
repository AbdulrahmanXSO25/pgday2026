"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { getSession, getSpeaker, schedule } from "@/lib/content";
import { PageHero } from "@/components/ui/page-hero";
import { Section } from "@/components/ui/section";
import { Badge } from "@/components/ui/badge";
import { formatTimeRange } from "@/lib/dates";

const LEVEL_LABELS: Record<string, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

function SessionDetailInner() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id") ?? "";
  const session = getSession(id);

  if (!session) {
    return (
      <Section>
        <p className="text-ink-muted">Session not found.</p>
        <Link href="/schedule" className="text-pg-blue mt-4 inline-block text-sm hover:underline">
          ← Back to schedule
        </Link>
      </Section>
    );
  }

  const speakers = session.speakerIds.map(getSpeaker).filter(Boolean);

  return (
    <>
      <PageHero
        eyebrow="Session"
        title={session.title}
        description={`${formatTimeRange(session.start, session.end)} · ${LEVEL_LABELS[session.level ?? ""] ?? "All levels"}`}
      />

      <Section>
        <div className="mx-auto max-w-3xl">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={session.type === "talk" || session.type === "keynote" ? "blue" : "neutral"}
            >
              {session.type}
            </Badge>
            {session.level && (
              <Badge variant="neutral">{LEVEL_LABELS[session.level] ?? session.level}</Badge>
            )}
            <span className="text-ink-muted text-sm">
              {formatTimeRange(session.start, session.end)}
            </span>
          </div>

          {session.abstract && (
            <div className="card mt-6 p-6 sm:p-8">
              <h2 className="text-pg-blue text-lg font-semibold">About this session</h2>
              <p className="text-ink-muted mt-3 leading-relaxed">{session.abstract}</p>
            </div>
          )}

          {speakers.length > 0 && (
            <div className="mt-6">
              <h2 className="text-pg-blue text-lg font-semibold">
                {speakers.length === 1 ? "Speaker" : "Speakers"}
              </h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {speakers.map((sp) => (
                  <Link
                    key={sp!.id}
                    href={`/speakers/detail?id=${sp!.id}`}
                    className="card hover:border-pg-blue flex items-center gap-4 p-4 transition-colors"
                  >
                    <div className="border-hairline bg-surface-raised flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border">
                      {sp!.photo ? (
                        <img
                          src={sp!.photo}
                          alt={sp!.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="text-ink-muted text-xs">{sp!.name.charAt(0)}</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold">{sp!.name}</p>
                      <p className="text-ink-muted text-sm">
                        {sp!.role}
                        {sp!.company ? ` · ${sp!.company}` : ""}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          <div className="mt-8">
            <Link href="/schedule" className="text-pg-blue text-sm hover:underline">
              ← Back to schedule
            </Link>
          </div>
        </div>
      </Section>
    </>
  );
}

export default function SessionDetailPage() {
  return (
    <Suspense fallback={<div className="text-ink-muted p-8 text-sm">Loading…</div>}>
      <SessionDetailInner />
    </Suspense>
  );
}
