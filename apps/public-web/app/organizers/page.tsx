import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Organizers",
  description:
    "Meet the volunteers from the PostgreSQL Egypt User Group organizing PG Day Egypt 2026.",
};

import { organizers } from "@/lib/content";
import { PageHero } from "@/components/ui/page-hero";
import { Section } from "@/components/ui/section";

export default function OrganizersPage() {
  return (
    <>
      <PageHero
        eyebrow="Organizers"
        title="Organizers"
        description="The volunteers behind PG Day Egypt 2026."
      />
      <Section>
        <div className="grid gap-6 sm:grid-cols-2">
          {organizers.map((o) => (
            <div key={o.id} className="card p-6">
              <h3 className="font-semibold">{o.name}</h3>
              <p className="text-pg-blue text-xs">{o.role}</p>
              <p className="text-ink-muted mt-2 text-sm leading-relaxed">{o.bio}</p>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}
