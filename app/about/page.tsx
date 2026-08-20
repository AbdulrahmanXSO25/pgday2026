import type { Metadata } from "next";
import { siteConfig } from "@/lib/config";
import { PageHero } from "@/components/ui/page-hero";
import { Section, SectionHeader } from "@/components/ui/section";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "About",
  description: `What PG Day Egypt 2026 is, who it's for, and why PostgreSQL — Egypt's first community conference for PostgreSQL users.`,
};

export default function AboutPage() {
  const audience = [
    "Backend engineers running services on Postgres",
    "DBAs and database reliability engineers",
    "Data and platform engineers",
    "Students curious about databases and open source",
    "Engineering managers evaluating Postgres for their teams",
  ];

  return (
    <>
      <PageHero
        eyebrow="$ SELECT * FROM about"
        title="Built by the community, for the community"
        description="The first edition of a one-day PostgreSQL conference in Egypt — organized entirely by volunteers who love this database and want to grow a local community around it."
      />

      <Section>
        <div className="grid gap-12 lg:grid-cols-[1.6fr_1fr] lg:gap-16">
          <div>
            <p className="text-ink-muted text-lg leading-relaxed">
              PG Day Egypt is a community-run, one-day conference for everyone who builds on
              PostgreSQL — backend engineers, DBAs, data engineers, and curious developers across
              Egypt and the wider MENA region. This is the first edition, organized entirely by
              volunteers who love this database and want to grow a local community around it.
            </p>
            <p className="text-ink-muted mt-6 text-lg leading-relaxed">
              Expect a single track of talks from local and regional practitioners, real production
              war stories, hallway conversations that matter, and a genuinely warm, welcoming room
              for first-time speakers and first-time conference-goers alike.
            </p>

            <h2 className="font-display text-ink mt-12 text-2xl font-bold">
              Why PostgreSQL, why now
            </h2>
            <p className="text-ink-muted mt-4 text-base leading-relaxed">
              PostgreSQL has become the world&apos;s most loved database — the default choice for
              startups, the migration target for enterprises leaving legacy commercial systems, and
              the foundation of managed offerings across every major cloud. Adoption across Egypt
              and the MENA region is growing fast, and yet there has never been a dedicated
              community conference here. This event exists to change that: to connect local
              practitioners, surface regional production experience, and give Egyptian engineers a
              home-grown stage to share what they&apos;ve learned.
            </p>
          </div>

          <div>
            <aside className="card p-7">
              <h2 className="font-display text-ink text-xl font-bold">Who should attend</h2>
              <ul className="mt-5 space-y-3.5">
                {audience.map((item) => (
                  <li
                    key={item}
                    className="text-ink-muted flex items-start gap-3 text-sm leading-relaxed"
                  >
                    <span aria-hidden="true" className="mono-data text-pg-blue mt-0.5">
                      ▸
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
              <div className="border-hairline mt-7 border-t pt-5">
                <Badge variant="blue">free to attend</Badge>
                <Badge variant="neutral" className="ml-2">
                  single track
                </Badge>
                <Badge variant="violet" className="ml-2">
                  english
                </Badge>
              </div>
            </aside>
          </div>
        </div>
      </Section>

      <Section className="border-hairline bg-surface border-t">
        <SectionHeader eyebrow="$ SELECT * FROM values" title="What we stand for" />
        <div className="grid gap-5 sm:grid-cols-3">
          {[
            {
              title: "Knowledge first",
              body: "Real production experience over product pitches. Every talk is selected for what engineers can learn from it.",
            },
            {
              title: "Community-run",
              body: `${siteConfig.organizer.name} is a volunteer group. The event is free and non-commercial.`,
            },
            {
              title: "Everyone welcome",
              body: "First-time conference-goers, first-time speakers, students and veterans — a warm room for all, backed by a clear Code of Conduct.",
            },
          ].map((value, i) => (
            <div key={value.title}>
              <article className="card card-hover h-full p-6">
                <p className="mono-data text-pg-blue">{`0${i + 1}`}</p>
                <h3 className="font-display text-ink mt-3 text-lg font-semibold">{value.title}</h3>
                <p className="text-ink-muted mt-2.5 text-sm leading-relaxed">{value.body}</p>
              </article>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}
