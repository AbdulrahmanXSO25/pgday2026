import type { Metadata } from "next";
import { speakers } from "@/lib/content";
import { PageHero } from "@/components/ui/page-hero";
import { Section } from "@/components/ui/section";
import { SpeakerGrid } from "@/components/speakers/speaker-grid";

export const metadata: Metadata = {
  title: "Speakers",
  description:
    "Meet the engineers sharing real production PostgreSQL experience at PG Day Egypt 2026 in Cairo.",
};

export default function SpeakersPage() {
  return (
    <>
      <PageHero
        eyebrow="$ SELECT * FROM speakers"
        title="Speakers"
        description="Meet the engineers sharing real production experience at PG Day Egypt 2026."
      />
      <Section>
        {/* h2 keeps heading order sequential above the speaker cards (h3) */}
        <h2 className="sr-only">Speaker lineup</h2>
        <SpeakerGrid speakers={speakers} />
      </Section>
    </>
  );
}
