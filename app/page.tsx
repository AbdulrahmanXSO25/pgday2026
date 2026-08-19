import Link from "next/link";
import { ArrowRight, CalendarDays, MapPin } from "lucide-react";
import { siteConfig } from "@/lib/config";
import { getVisibleSponsors, schedule, speakers } from "@/lib/content";
import { TerminalWindow } from "@/components/ui/terminal-window";
import { CountdownBadge } from "@/components/ui/countdown-badge";
import { Button } from "@/components/ui/button";
import { Section, SectionHeader } from "@/components/ui/section";
import { Reveal } from "@/components/ui/reveal";
import { SpeakerGrid } from "@/components/speakers/speaker-grid";
import { ScheduleList } from "@/components/schedule/schedule-list";
import { SponsorTier } from "@/components/sponsors/sponsor-grid";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-static";

export default function HomePage() {
  const { event, features, organizer } = siteConfig;
  const talkCount = schedule.reduce((total, session) => total + session.speakerIds.length, 0);
  const featuredSpeakers = speakers.slice(0, 4);
  const teaserSessions = schedule
    .filter((s) => s.type !== "break" && s.type !== "logistics")
    .slice(0, 3);
  const visibleSponsors = getVisibleSponsors();

  const eventJsonLd = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: event.name,
    description: event.tagline,
    startDate: event.date,
    endDate: event.date,
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location:
      event.venueStatus === "confirmed"
        ? {
            "@type": "Place",
            name: event.venueName,
            address: event.venueAddress,
          }
        : {
            "@type": "Place",
            name: "Venue to be announced",
            address: {
              "@type": "PostalAddress",
              addressLocality: "Cairo",
              addressCountry: "EG",
            },
          },
    organizer: {
      "@type": "Organization",
      name: organizer.name,
      email: organizer.contactEmail,
    },
    isAccessibleForFree: true,
    inLanguage: "en",
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(eventJsonLd) }}
      />

      {/* 1. Terminal hero */}
      <section className="grid-texture border-hairline relative overflow-hidden border-b">
        <div
          aria-hidden="true"
          className="bg-neon-teal/10 pointer-events-none absolute -top-40 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full blur-3xl"
        />
        <div className="relative mx-auto grid w-full max-w-6xl items-center gap-12 px-5 pt-16 pb-20 sm:px-8 sm:pt-24 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
          <div>
            {features.showCountdown && <CountdownBadge dateISO={event.date} className="mb-6" />}
            <h1 className="font-display text-ink text-4xl leading-[1.08] font-bold tracking-tight sm:text-5xl lg:text-6xl">
              {event.name}
            </h1>
            <p className="text-ink-muted mt-4 max-w-xl text-lg leading-relaxed sm:text-xl">
              {event.tagline}. One day, one track, eight talks from people who run PostgreSQL in
              production.
            </p>

            <p className="mono-data text-ink-muted mt-6 flex flex-wrap items-center gap-x-5 gap-y-2">
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays aria-hidden="true" className="text-neon-teal size-4" />
                {event.dateDisplay}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <MapPin aria-hidden="true" className="text-neon-teal size-4" />
                {event.city} · Venue TBA
              </span>
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button href="/register" className="animate-pulse-glow">
                Register to Attend <ArrowRight aria-hidden="true" className="size-4" />
              </Button>
              <Button href="/schedule" variant="secondary">
                View Schedule
              </Button>
            </div>
          </div>

          <Reveal delay={150} className="hidden lg:block">
            <TerminalWindow query />
          </Reveal>
        </div>
      </section>

      {/* 2. Quick facts strip */}
      <section aria-label="Event quick facts" className="border-hairline bg-surface/40 border-b">
        <div className="mono-data mx-auto grid w-full max-w-6xl grid-cols-2 gap-px px-5 sm:px-8 md:grid-cols-4">
          {[
            { k: "duration", v: "1 day" },
            { k: "talks", v: `${talkCount} talks` },
            { k: "city", v: event.city },
            { k: "cost", v: "Free to attend" },
          ].map((fact) => (
            <div key={fact.k} className="px-2 py-6 text-center sm:py-7">
              <p className="text-ink text-lg sm:text-xl">{fact.v}</p>
              <p className="mono-data text-ink-muted mt-1 text-[10px] uppercase">{fact.k}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 3. About teaser */}
      <Section>
        <SectionHeader
          eyebrow="$ SELECT about FROM community WHERE year = 2026"
          title="A conference for people who build on Postgres"
          description="PG Day Egypt is a community-run, one-day conference for everyone who builds on PostgreSQL — backend engineers, DBAs, data engineers, and curious developers across Egypt and the wider MENA region."
        />
        <p className="text-ink-muted max-w-3xl text-base leading-relaxed sm:text-lg">
          Expect a single track of talks from local and regional practitioners, real production war
          stories, hallway conversations that matter, and a genuinely warm, welcoming room for
          first-time speakers and first-time conference-goers alike.
        </p>
        <Link
          href="/about"
          className="text-neon-teal mt-6 inline-flex items-center gap-1.5 text-sm font-semibold hover:underline"
        >
          Read more about PG Day Egypt <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </Section>

      {/* 4. Featured speakers */}
      <Section className="border-hairline bg-surface/30 border-y" texture>
        <SectionHeader
          eyebrow="$ SELECT * FROM speakers LIMIT 4"
          title="Featured speakers"
          description="Local and regional engineers sharing real production experience — no vendor pitches, just Postgres."
        />
        <SpeakerGrid speakers={featuredSpeakers} />
        <div className="mt-10 text-center">
          <Button href="/speakers" variant="secondary">
            View all speakers <ArrowRight aria-hidden="true" className="size-4" />
          </Button>
        </div>
      </Section>

      {/* 5. Schedule teaser */}
      <Section>
        <SectionHeader
          eyebrow="$ SELECT * FROM schedule ORDER BY start LIMIT 3"
          title="A day of Postgres, start to finish"
          description={`Single track on ${event.dateDisplay}. Sessions run from 09:00 to 17:00, with coffee and lunch in between.`}
        />
        <ScheduleList items={teaserSessions} limit={3} />
        <div className="mt-10 text-center">
          <Button href="/schedule" variant="secondary">
            View full schedule <ArrowRight aria-hidden="true" className="size-4" />
          </Button>
        </div>
      </Section>

      {/* 6. Sponsors strip (flag-controlled) */}
      {features.showSponsors && visibleSponsors.length > 0 && (
        <Section className="border-hairline bg-surface/30 border-y" texture>
          <SectionHeader
            eyebrow="$ SELECT * FROM sponsors WHERE visible = true"
            title="Supported by"
          />
          <SponsorTier
            tier="platinum"
            sponsors={visibleSponsors.filter((s) => s.tier === "platinum")}
          />
          <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
            <Badge variant="neutral">more partners to be announced</Badge>
            <Link
              href="/sponsors"
              className="text-neon-teal inline-flex items-center gap-1.5 text-sm font-semibold hover:underline"
            >
              View all sponsors <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </div>
        </Section>
      )}

      {/* 7. Final CTA band */}
      <Section>
        <div className="card relative overflow-hidden p-8 text-center sm:p-14">
          <div
            aria-hidden="true"
            className="bg-neon-teal/15 pointer-events-none absolute inset-x-0 -top-24 mx-auto h-48 w-96 rounded-full blur-3xl"
          />
          <h2 className="font-display text-ink relative text-3xl font-bold tracking-tight sm:text-4xl">
            Free to attend. Registration required.
          </h2>
          <p className="text-ink-muted relative mx-auto mt-3 max-w-xl">
            Seats are limited by the venue — register now and we&apos;ll confirm your attendance
            closer to the event.
          </p>
          <div className="relative mt-8">
            <Button href="/register" className="animate-pulse-glow">
              Register to Attend <ArrowRight aria-hidden="true" className="size-4" />
            </Button>
          </div>
        </div>
      </Section>
    </>
  );
}
