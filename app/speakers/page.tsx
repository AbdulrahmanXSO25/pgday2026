import type { Metadata } from "next";
import { speakers } from "@/lib/content";
import { PageHero } from "@/components/ui/page-hero";
import { SpeakerGrid } from "@/components/speakers/speaker-grid";
import { Section } from "@/components/ui/section";

export const metadata: Metadata = {
  title: "Speakers",
  description: `Meet the speakers of PG Day Egypt 2026 — local and regional engineers sharing real PostgreSQL production experience.`,
};

export default function SpeakersPage() {
  return (
    <>
      <PageHero
        eyebrow="$ SELECT * FROM speakers"
        title="Speakers"
        description="Local and regional engineers sharing real production experience — no vendor pitches, just Postgres."
      />

      <Section>
        <SpeakerGrid speakers={speakers} />
      </Section>
    </>
  );
}
