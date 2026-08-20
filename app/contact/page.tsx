import type { Metadata } from "next";
import { Mail } from "lucide-react";
import { LinkedInIcon, XIcon, YouTubeIcon } from "@/components/ui/social-icons";
import { siteConfig } from "@/lib/config";
import { PageHero } from "@/components/ui/page-hero";
import { Section } from "@/components/ui/section";

export const metadata: Metadata = {
  title: "Contact",
  description: `Contact the PG Day Egypt 2026 organizing team — questions, sponsorship, and press.`,
};

export default function ContactPage() {
  const { organizer, social } = siteConfig;

  const channels = [
    {
      label: "Email",
      value: organizer.contactEmail,
      href: `mailto:${organizer.contactEmail}`,
      icon: Mail,
      note: "general questions, sponsorship, and press",
    },
    ...(social.twitter
      ? [
          {
            label: "X / Twitter",
            value: social.twitter.replace("https://", "").replace(/\/$/, ""),
            href: social.twitter,
            icon: XIcon,
            note: "announcements and community chatter",
          },
        ]
      : []),
    ...(social.linkedin
      ? [
          {
            label: "LinkedIn",
            value: social.linkedin.replace("https://", "").replace(/\/$/, ""),
            href: social.linkedin,
            icon: LinkedInIcon,
            note: "company page and professional updates",
          },
        ]
      : []),
    ...(social.youtube
      ? [
          {
            label: "YouTube",
            value: social.youtube.replace("https://", "").replace(/\/$/, ""),
            href: social.youtube,
            icon: YouTubeIcon,
            note: "talk recordings after the event",
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHero
        eyebrow="$ \c pgegypt --connect"
        title="Contact"
        description="Questions about attending? Interested in sponsoring? Press inquiry? Reach the organizing team directly."
      />

      <Section>
        <ul className="mx-auto grid max-w-3xl grid-cols-1 gap-5 sm:grid-cols-2">
          {channels.map((channel) => (
            <li key={channel.label}>
              <a
                href={channel.href}
                target={channel.href.startsWith("mailto:") ? undefined : "_blank"}
                rel={channel.href.startsWith("mailto:") ? undefined : "noopener noreferrer"}
                className="card card-hover flex h-full items-start gap-4 p-6"
              >
                <channel.icon aria-hidden="true" className="text-pg-blue mt-0.5 size-5 shrink-0" />
                <span className="min-w-0">
                  <span className="mono-data text-ink-muted block">{channel.label}</span>
                  <span className="text-ink mt-1 block text-sm font-semibold break-words">
                    {channel.value}
                  </span>
                  <span className="text-ink-muted mt-1 block text-xs">{channel.note}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>

        <p className="mono-data text-ink-muted mx-auto mt-10 max-w-3xl text-center text-[11px] leading-relaxed">
          -- sponsorship & press inquiries are handled by email; no contact form in v1, keeping
          things simple.
        </p>
      </Section>
    </>
  );
}
