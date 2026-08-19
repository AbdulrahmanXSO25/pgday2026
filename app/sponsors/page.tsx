import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { siteConfig } from "@/lib/config";
import { getVisibleSponsors } from "@/lib/content";
import { PageHero } from "@/components/ui/page-hero";
import { Section } from "@/components/ui/section";
import { SponsorGrid } from "@/components/sponsors/sponsor-grid";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Sponsors",
  description: `Sponsors and partners supporting PG Day Egypt 2026 — Egypt's first PostgreSQL community conference.`,
};

export default function SponsorsPage() {
  if (!siteConfig.features.showSponsors) {
    notFound();
  }

  const visibleSponsors = getVisibleSponsors();

  return (
    <>
      <PageHero
        eyebrow="$ SELECT * FROM sponsors ORDER BY tier"
        title="Sponsors"
        description="PG Day Egypt is a free, community-run event made possible by companies that believe in the PostgreSQL community across the region."
      />

      <Section>
        {visibleSponsors.length > 0 ? (
          <SponsorGrid sponsors={visibleSponsors} />
        ) : (
          <p className="text-ink-muted">Sponsors will be announced soon.</p>
        )}

        <div className="card mt-14 p-8 text-center sm:p-10">
          <h2 className="font-display text-ink text-2xl font-bold">
            Interested in sponsoring PG Day Egypt?
          </h2>
          <p className="text-ink-muted mx-auto mt-3 max-w-xl leading-relaxed">
            Reach the engineers who run Egypt&apos;s most demanding PostgreSQL workloads. We&apos;d
            love to talk about partnership options for this edition and beyond.
          </p>
          <div className="mt-6">
            <Button href="/contact">Get in touch</Button>
          </div>
        </div>
      </Section>
    </>
  );
}
