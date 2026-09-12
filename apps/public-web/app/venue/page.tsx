import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Venue",
  description:
    "Venue details for PG Day Egypt 2026 in Cairo — location to be announced. Check back for the confirmed address, directions, and accessibility info.",
};

import { PageHero } from "@/components/ui/page-hero";
import { Section } from "@/components/ui/section";

export default function VenuePage() {
  return (
    <>
      <PageHero
        eyebrow="$ SELECT venue FROM events WHERE year = 2026"
        title="Venue"
        description="Cairo, Egypt — venue to be announced."
      />
      <Section>
        <div className="card p-8 text-center">
          <p className="text-pg-blue text-sm">Venue to be announced</p>
          <p className="text-ink-muted mt-3">Venue details will be announced soon. Stay tuned.</p>
        </div>
      </Section>
    </>
  );
}
