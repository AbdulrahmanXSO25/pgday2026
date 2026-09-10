import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Code of Conduct",
  description:
    "The PG Day Egypt 2026 Code of Conduct — the standards we expect from every attendee, speaker, sponsor, and volunteer, and how to report an issue.",
};

import { PageHero } from "@/components/ui/page-hero";
import { Section } from "@/components/ui/section";

export default function CodeOfConductPage() {
  return (
    <>
      <PageHero eyebrow="$ cat CODE_OF_CONDUCT.md" title="Code of Conduct" />
      <Section>
        <div className="prose prose-neutral max-w-3xl">
          <p className="text-ink-muted leading-relaxed">
            PG Day Egypt is dedicated to providing a harassment-free experience for everyone,
            regardless of gender, gender identity, sexual orientation, disability, physical
            appearance, body size, race, or religion. We do not tolerate harassment of participants
            in any form.
          </p>
          <p className="text-ink-muted mt-4 leading-relaxed">
            All attendees, speakers, sponsors, and volunteers are required to agree to this code of
            conduct. Organizers will enforce this code throughout the event.
          </p>
        </div>
      </Section>
    </>
  );
}
