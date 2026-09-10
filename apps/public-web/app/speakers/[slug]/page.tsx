import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSpeaker, getSpeakerSessions } from "@/lib/content";
import { PageHero } from "@/components/ui/page-hero";
import { Section } from "@/components/ui/section";

export const dynamic = "force-static";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const speaker = getSpeaker(slug);
  if (!speaker) return { title: "Speaker" };
  return {
    title: speaker.name,
    description: `${speaker.name} — ${speaker.role}${speaker.company ? ` at ${speaker.company}` : ""}, speaking at PG Day Egypt 2026.`,
  };
}

export function generateStaticParams() {
  // keep static export minimal — actual speakers injected via content at build
  return [{ slug: "karim-el-sayed" }];
}

export default async function SpeakerPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const speaker = getSpeaker(slug);
  if (!speaker) return notFound();
  const sessions = getSpeakerSessions(speaker.id);

  return (
    <>
      <PageHero
        eyebrow={`$ SELECT * FROM speakers WHERE id = '${slug}'`}
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
