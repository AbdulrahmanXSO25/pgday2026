import type { Metadata } from "next";
import { faqItems } from "@/lib/content";
import { PageHero } from "@/components/ui/page-hero";
import { Section } from "@/components/ui/section";
import { FaqAccordion } from "@/components/ui/faq-accordion";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "FAQ",
  description: `Frequently asked questions about PG Day Egypt 2026 — cost, language, recordings, audience, and more.`,
};

export default function FaqPage() {
  return (
    <>
      <PageHero
        eyebrow="$ SELECT * FROM faq"
        title="Frequently asked questions"
        description="Everything you need to know about attending PG Day Egypt 2026."
      />

      <Section>
        <FaqAccordion items={faqItems} />

        <div className="mt-12 text-center">
          <p className="text-ink-muted">Still have a question?</p>
          <div className="mt-4">
            <Button href="/contact" variant="secondary">
              Contact us
            </Button>
          </div>
        </div>
      </Section>
    </>
  );
}
