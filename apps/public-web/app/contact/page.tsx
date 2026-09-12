import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Get in touch with the PG Day Egypt 2026 organizers — email, X/Twitter, and LinkedIn.",
};

import { siteConfig } from "@/lib/config";
import { PageHero } from "@/components/ui/page-hero";
import { Section } from "@/components/ui/section";

export default function ContactPage() {
  return (
    <>
      <PageHero
        eyebrow="$ SELECT contact FROM organizers"
        title="Contact"
        description="Get in touch with the organizing team."
      />
      <Section>
        <div className="card max-w-xl p-8">
          <p className="text-pg-blue mb-2 text-sm font-semibold">Email</p>
          <a
            href={`mailto:${siteConfig.organizer.contactEmail}`}
            className="text-pg-blue font-semibold"
          >
            {siteConfig.organizer.contactEmail}
          </a>
          <p className="text-ink-muted mt-4 text-sm">
            We typically reply within 1–2 business days.
          </p>
        </div>
      </Section>
    </>
  );
}
