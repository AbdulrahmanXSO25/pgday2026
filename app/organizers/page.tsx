import type { Metadata } from "next";
import { LinkedInIcon, XIcon } from "@/components/ui/social-icons";
import { organizers } from "@/lib/content";
import { PageHero } from "@/components/ui/page-hero";
import { Section } from "@/components/ui/section";
import { Reveal } from "@/components/ui/reveal";

export const metadata: Metadata = {
  title: "Organizers",
  description: `Meet the volunteer team behind PG Day Egypt 2026.`,
};

export default function OrganizersPage() {
  return (
    <>
      <PageHero
        eyebrow="$ SELECT * FROM organizers"
        title="Organizers"
        description="PG Day Egypt is run by volunteers. Meet the people making the first edition happen."
      />

      <Section>
        <ul className="grid gap-5 sm:grid-cols-2">
          {organizers.map((organizer, i) => (
            <Reveal as="li" key={organizer.id} delay={Math.min(i, 3) * 70}>
              <article className="card card-hover h-full p-6">
                <div className="flex items-center gap-4">
                  <div
                    aria-hidden="true"
                    className="mono-data border-neon-teal/40 bg-neon-teal/10 text-neon-teal flex size-12 shrink-0 items-center justify-center rounded-full border text-lg"
                  >
                    {organizer.name
                      .split(" ")
                      .map((part) => part[0])
                      .join("")}
                  </div>
                  <div>
                    <h2 className="font-display text-ink text-lg font-semibold">
                      {organizer.name}
                    </h2>
                    <p className="mono-data text-ink-muted">{organizer.role}</p>
                  </div>
                </div>
                <p className="text-ink-muted mt-4 text-sm leading-relaxed">{organizer.bio}</p>
                <div className="mt-4 flex items-center gap-3">
                  {organizer.social.linkedin && (
                    <a
                      href={organizer.social.linkedin}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${organizer.name} on LinkedIn`}
                      className="text-ink-muted hover:text-neon-teal transition-colors"
                    >
                      <LinkedInIcon className="size-4" />
                    </a>
                  )}
                  {organizer.social.twitter && (
                    <a
                      href={organizer.social.twitter}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${organizer.name} on X`}
                      className="text-ink-muted hover:text-neon-teal transition-colors"
                    >
                      <XIcon className="size-4" />
                    </a>
                  )}
                </div>
              </article>
            </Reveal>
          ))}
        </ul>
      </Section>
    </>
  );
}
