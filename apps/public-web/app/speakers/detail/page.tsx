"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { getSpeaker, getSpeakerSessions } from "@/lib/content";
import { PageHero } from "@/components/ui/page-hero";
import { Section } from "@/components/ui/section";

/**
 * Speaker detail — query-param page (/speakers/detail?id=...).
 * Static export cannot have dynamic [slug] routes with zero params (empty
 * generateStaticParams is a build error), and the published snapshot may
 * legitimately contain zero speakers. Query-param routing handles both.
 */

function SpeakerDetailInner() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id") ?? "";
  const speaker = getSpeaker(id);

  if (!speaker) {
    return (
      <Section>
        <p className="text-ink-muted">Speaker not found.</p>
      </Section>
    );
  }

  const sessions = getSpeakerSessions(speaker.id);

  return (
    <>
      <PageHero
        eyebrow="Speaker"
        title={speaker.name}
        description={`${speaker.role} · ${speaker.company}`}
      />
      <Section>
        <p className="text-ink-muted max-w-2xl leading-relaxed">{speaker.bio}</p>
        {sessions.length > 0 && (
          <div className="mt-8">
            <h2 className="mono-data text-pg-blue mb-3">sessions</h2>
            <ul className="space-y-2">
              {sessions.map((s) => (
                <li key={s.id} className="card p-4">
                  <p className="font-semibold">{s.title}</p>
                  <p className="mono-data text-ink-muted text-xs">
                    {s.start} — {s.end}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>
    </>
  );
}

export default function SpeakerDetailPage() {
  return (
    <Suspense fallback={<div className="text-ink-muted p-8 text-sm">Loading…</div>}>
      <SpeakerDetailInner />
    </Suspense>
  );
}
