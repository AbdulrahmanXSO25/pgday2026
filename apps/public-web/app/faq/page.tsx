import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "FAQ",
  description:
    "Frequently asked questions about PG Day Egypt 2026 — registration, talks, venue, food, and accessibility.",
};

import { faqItems } from "@/lib/content";
import { PageHero } from "@/components/ui/page-hero";
import { FaqAccordion } from "@/components/ui/faq-accordion";
import { Section } from "@/components/ui/section";

export default function FaqPage() {
  return (
    <>
      <PageHero
        eyebrow="$ SELECT * FROM faq"
        title="FAQ"
        description="Frequently asked questions about PG Day Egypt 2026."
      />
      <Section>
        <FaqAccordion items={faqItems} />
      </Section>
    </>
  );
}
