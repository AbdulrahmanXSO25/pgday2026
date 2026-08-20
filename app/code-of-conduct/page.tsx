import type { Metadata } from "next";
import { siteConfig } from "@/lib/config";
import { PageHero } from "@/components/ui/page-hero";
import { Section } from "@/components/ui/section";

export const metadata: Metadata = {
  title: "Code of Conduct",
  description: `Code of Conduct for PG Day Egypt 2026 — everyone deserves a respectful, safe, and welcoming conference experience.`,
};

export default function CodeOfConductPage() {
  const contact = siteConfig.organizer.contactEmail;

  return (
    <>
      <PageHero
        eyebrow="$ SET ROLE community_member"
        title="Code of Conduct"
        description="PG Day Egypt is dedicated to providing a respectful, safe, and welcoming experience for everyone — attendees, speakers, sponsors, organizers, and volunteers."
      />

      <Section>
        <div className="max-w-3xl space-y-10">
          <CoCSection title="Our promise">
            <p>
              Every participant has the right to enjoy the conference without fear of harassment or
              exclusion. We commit to creating an environment where people of all backgrounds,
              identities, and experience levels can learn from each other and share their love of
              PostgreSQL. We welcome first-time conference-goers, first-time speakers, students, and
              veterans equally.
            </p>
          </CoCSection>

          <CoCSection title="Expected behavior">
            <ul className="list-disc space-y-2 pl-5">
              <li>Be respectful and considerate in your words and actions.</li>
              <li>Listen when others speak, and make space for quieter voices.</li>
              <li>Assume good intent, and ask questions instead of making assumptions.</li>
              <li>
                Critique ideas, not people — technical disagreements are healthy; personal attacks
                are not.
              </li>
              <li>Follow the instructions of event organizers and venue staff.</li>
            </ul>
          </CoCSection>

          <CoCSection title="Unacceptable behavior">
            <p>Unacceptable behavior includes, but is not limited to:</p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                Harassment, intimidation, or discrimination in any form — including on the basis of
                gender, race, ethnicity, religion, age, disability, sexual orientation, or physical
                appearance.
              </li>
              <li>
                Sexual language or imagery in talks, workshops, or conversations where it is not
                appropriate to the subject matter.
              </li>
              <li>Sustained disruption of talks or other conference activities.</li>
              <li>
                Unwelcome physical contact or attention, including inappropriate photography or
                recording.
              </li>
              <li>Advocating for, or encouraging, any of the above behavior.</li>
            </ul>
          </CoCSection>

          <CoCSection title="Reporting">
            <p>
              If you experience or witness a violation of this Code of Conduct, please report it as
              soon as possible. You can:
            </p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                Email the organizing team at{" "}
                <a href={`mailto:${contact}`} className="text-pg-blue font-medium hover:underline">
                  {contact}
                </a>{" "}
                — monitored before, during, and after the event.
              </li>
              <li>
                Speak to any organizer or volunteer on site — they are briefed to help and can act
                immediately.
              </li>
            </ul>
            <p className="mt-4">
              All reports are handled confidentially. Your name will never be shared with the person
              you are reporting.
            </p>
          </CoCSection>

          <CoCSection title="Enforcement">
            <p>
              Anyone asked to stop unacceptable behavior is expected to comply immediately. The
              organizing team may take any action they deem appropriate, up to and including a
              warning, removal from the event, or a ban from future events. If you are removed from
              the event, you will not be eligible for a refund of any costs paid (the event is free
              to attend, so this rarely matters — but we hold the principle).
            </p>
          </CoCSection>

          <p className="mono-data border-hairline text-ink-muted border-t pt-6 text-[11px]">
            -- this code of conduct applies to the venue, all conference activities, and official
            online spaces.
          </p>
        </div>
      </Section>
    </>
  );
}

function CoCSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-display text-xl font-bold">
        <span className="mono-data text-pg-blue mr-3">--</span>
        {title}
      </h2>
      <div className="text-ink-muted mt-3 space-y-3 leading-relaxed">{children}</div>
    </section>
  );
}
