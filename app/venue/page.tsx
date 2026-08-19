import type { Metadata } from "next";
import { MapPin } from "lucide-react";
import { siteConfig } from "@/lib/config";
import { PageHero } from "@/components/ui/page-hero";
import { Section } from "@/components/ui/section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Venue",
  description: `Venue information for PG Day Egypt 2026 in Cairo. The venue is being finalized — register to be notified as soon as it's confirmed.`,
};

export default function VenuePage() {
  const { event } = siteConfig;

  return (
    <>
      <PageHero
        eyebrow="$ SELECT * FROM venue"
        title="Venue"
        description="We're finalizing the venue for PG Day Egypt 2026 in Cairo and will update this page as soon as it's confirmed."
      >
        <div className="mt-6">
          <Badge variant="amber">venue to be announced</Badge>
        </div>
      </PageHero>

      <Section>
        <div className="card p-8 sm:p-10">
          <h2 className="font-display text-ink text-2xl font-bold">Venue: To be announced</h2>
          <p className="text-ink-muted mt-3 max-w-2xl leading-relaxed">
            We&apos;re working to confirm a venue in Cairo that fits the size and spirit of a
            first-edition community conference. Register now to be notified the moment details go
            live — no spam, just venue and event updates.
          </p>
          <div className="mt-7">
            <Button href="/register">Register to get notified</Button>
          </div>
        </div>

        <div
          aria-hidden="true"
          className="grid-texture border-hairline bg-surface/40 mt-6 flex min-h-[220px] items-center justify-center rounded-xl border border-dashed"
        >
          <div className="text-center">
            <MapPin aria-hidden="true" className="text-ink-muted/50 mx-auto size-8" />
            <p className="mono-data text-ink-muted mt-3">
              map will appear here once the venue is confirmed
            </p>
          </div>
        </div>

        <dl className="mono-data mt-10 grid gap-4 text-sm sm:grid-cols-2">
          <div className="card p-5">
            <dt className="text-ink-muted">-- city</dt>
            <dd className="text-ink mt-1">{event.city}</dd>
          </div>
          <div className="card p-5">
            <dt className="text-ink-muted">-- status</dt>
            <dd className="text-neon-amber mt-1">tba</dd>
          </div>
        </dl>
      </Section>
    </>
  );
}
