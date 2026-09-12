import type { Metadata } from "next";
import { siteConfig } from "@/lib/config";
import { schedule } from "@/lib/content";
import { PageHero } from "@/components/ui/page-hero";
import { ScheduleList } from "@/components/schedule/schedule-list";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/section";

export const metadata: Metadata = {
  title: "Schedule",
  description: `The full single-track agenda for PG Day Egypt 2026 — ${siteConfig.event.dateDisplay} in Cairo. Talks, keynote, panel, and breaks.`,
};

export default function SchedulePage() {
  const talkCount = schedule.reduce((total, session) => total + session.speakerIds.length, 0);

  return (
    <>
      <PageHero
        eyebrow="Agenda"
        title="Schedule"
        description={`One track, ${talkCount} talks, and plenty of coffee — ${siteConfig.event.dateDisplay}, Cairo. All times in ${siteConfig.event.timezone.replace("_", "/")} local time.`}
      />

      <Section>
        {/* h2 keeps heading order sequential above the session rows (h3) */}
        <h2 className="sr-only">Full agenda</h2>
        <ScheduleList items={schedule} />

        <div className="mt-12 flex flex-col items-center gap-4 text-center">
          <p className="text-ink-muted text-sm">
            The agenda is subject to change before the event.
          </p>
          <Button href="/register">Reserve your spot</Button>
        </div>
      </Section>
    </>
  );
}
