import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarDays } from "lucide-react";
import { LinkedInIcon, XIcon } from "@/components/ui/social-icons";
import { getSession, getSpeaker, speakers } from "@/lib/content";
import { Section } from "@/components/ui/section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { sessionTypeLabels } from "@/lib/content";

export const dynamic = "force-static";

export function generateStaticParams() {
  return speakers.map((speaker) => ({ slug: speaker.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const speaker = getSpeaker(slug);
  if (!speaker) return { title: "Speaker not found" };
  return {
    title: speaker.name,
    description: `${speaker.name}, ${speaker.role} at ${speaker.company} — speaker at PG Day Egypt 2026. ${speaker.bio}`,
    openGraph: {
      title: `${speaker.name} · PG Day Egypt 2026`,
      description: `${speaker.role} at ${speaker.company}`,
      images: [{ url: speaker.photo, width: 512, height: 512, alt: speaker.name }],
    },
  };
}

export default async function SpeakerDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const speaker = getSpeaker(slug);
  if (!speaker) notFound();

  const session = getSession(speaker.talkId);

  return (
    <>
      <Section className="pb-6">
        <Link
          href="/speakers"
          className="mono-data text-ink-muted hover:text-pg-blue inline-flex items-center gap-2 transition-colors"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />$ cd ../speakers
        </Link>
      </Section>

      <Section className="pt-2">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,380px)_1fr] lg:gap-14">
          <div>
            <div className="card overflow-hidden">
              <div className="relative aspect-square">
                <Image
                  src={speaker.photo}
                  alt={`Portrait of ${speaker.name}`}
                  fill
                  priority
                  sizes="(min-width: 1024px) 380px, 100vw"
                  className="object-cover"
                />
              </div>
            </div>

            <div className="mt-5 flex items-center gap-3">
              {speaker.social.linkedin && (
                <a
                  href={speaker.social.linkedin}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${speaker.name} on LinkedIn`}
                  className="border-hairline text-ink-muted hover:border-pg-blue hover:text-pg-blue rounded-sm border p-2.5 transition-colors"
                >
                  <LinkedInIcon className="size-4" />
                </a>
              )}
              {speaker.social.twitter && (
                <a
                  href={speaker.social.twitter}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${speaker.name} on X`}
                  className="border-hairline text-ink-muted hover:border-pg-blue hover:text-pg-blue rounded-sm border p-2.5 transition-colors"
                >
                  <XIcon className="size-4" />
                </a>
              )}
            </div>
          </div>

          <div>
            <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">
              {speaker.name}
            </h1>
            <p className="mono-data text-ink-muted mt-3">
              {speaker.role} · {speaker.company}
            </p>

            <div className="mt-6 flex flex-wrap gap-2">
              {session && (
                <>
                  <Badge variant="neutral" className="normal-case">
                    {sessionTypeLabels[session.type]}
                  </Badge>
                  {session.level && <Badge variant="violet">{session.level}</Badge>}
                </>
              )}
            </div>

            <p className="text-ink-muted mt-6 max-w-2xl text-base leading-relaxed sm:text-lg">
              {speaker.bio}
            </p>

            {session && (
              <div className="card mt-10 p-6">
                <p className="mono-data text-pg-blue">
                  -- session · {session.start}–{session.end}
                </p>
                <h2 className="font-display mt-2 text-xl font-semibold">{session.title}</h2>
                {session.abstract && (
                  <p className="text-ink-muted mt-3 text-sm leading-relaxed">{session.abstract}</p>
                )}
                <div className="mt-5 flex flex-wrap items-center gap-4">
                  <Button href={`/schedule#${session.id}`} variant="secondary">
                    <CalendarDays aria-hidden="true" className="size-4" />
                    View in schedule
                  </Button>
                  <Button href="/register">Register to attend</Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </Section>
    </>
  );
}
