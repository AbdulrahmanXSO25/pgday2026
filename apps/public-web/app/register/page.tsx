import type { Metadata } from "next";
import { siteConfig } from "@/lib/config";
import { PageHero } from "@/components/ui/page-hero";
import { Section } from "@/components/ui/section";
import { RegisterForm } from "@/components/register/register-form";

export const metadata: Metadata = {
  title: "Register to Attend",
  description: `Register for PG Day Egypt 2026 — free to attend, Saturday October 10, 2026 in Cairo. Seats are limited.`,
};

export default function RegisterPage() {
  const { registration, event } = siteConfig;

  return (
    <>
      <PageHero
        eyebrow="$ INSERT INTO attendees VALUES (you, 2026)"
        title="Register to Attend"
        description={`Join us in ${event.city} on ${event.dateDisplay}. Free to attend — register now and we'll confirm your attendance closer to the event.`}
      />

      <Section>
        {registration.open ? (
          <RegisterForm />
        ) : (
          <div className="card mx-auto max-w-xl p-8 text-center sm:p-10">
            <h2 className="font-display text-2xl font-bold">Registration is closed</h2>
            <p className="text-ink-muted mt-3 leading-relaxed">{registration.closedMessage}</p>
          </div>
        )}

        <p className="text-ink-muted mx-auto mt-8 max-w-xl text-center text-sm leading-relaxed">
          -- by registering you agree to be contacted about the event. we never share your data with
          sponsors or third parties.
        </p>
      </Section>
    </>
  );
}
