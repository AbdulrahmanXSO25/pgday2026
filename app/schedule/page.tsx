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
        eyebrow="$ SELECT * FROM schedule ORDER BY start"
        title="Schedule"
        description={`One track, ${talkCount} talks, and plenty of coffee — ${siteConfig.event.dateDisplay}, Cairo. All times in ${siteConfig.event.timezone.replace("_", "/")} local time.`}
      />

      <Section>
        <ScheduleList items={schedule} />

        <div className="mt-12 flex flex-col items-center gap-4 text-center">
          <p className="mono-data text-ink-muted">
            -- 13 rows returned · subject to change before the event
          </p>
          <Button href="/register">Reserve your spot</Button>
        </div>
      </Section>
    </>
  );
}
