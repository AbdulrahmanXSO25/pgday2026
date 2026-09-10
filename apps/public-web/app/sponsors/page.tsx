import type { Metadata } from "next";
import { getVisibleSponsors } from "@/lib/content";
import { PageHero } from "@/components/ui/page-hero";
import { Section } from "@/components/ui/section";
import { SponsorTier } from "@/components/sponsors/sponsor-grid";

export const metadata: Metadata = { title: "Sponsors" };

export default function SponsorsPage() {
  const visible = getVisibleSponsors();
  return (
    <>
      <PageHero
        eyebrow="$ SELECT * FROM sponsors WHERE visible = true"
        title="Sponsors"
        description="Thank you to our sponsors — without them PG Day Egypt would not be possible."
      />
      <Section>
        <SponsorTier tier="platinum" sponsors={visible.filter((s) => s.tier === "platinum")} />
        <SponsorTier tier="gold" sponsors={visible.filter((s) => s.tier === "gold")} />
        <SponsorTier tier="silver" sponsors={visible.filter((s) => s.tier === "silver")} />
        <SponsorTier tier="community" sponsors={visible.filter((s) => s.tier === "community")} />
      </Section>
    </>
  );
}
