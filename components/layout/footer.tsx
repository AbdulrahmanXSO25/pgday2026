import Link from "next/link";
import { siteConfig } from "@/lib/config";
import { Logo } from "@/components/ui/logo";

const eventLinks = [
  { href: "/about", label: "About" },
  { href: "/schedule", label: "Schedule" },
  { href: "/speakers", label: "Speakers" },
  { href: "/venue", label: "Venue" },
  ...(siteConfig.features.showSponsors ? [{ href: "/sponsors", label: "Sponsors" }] : []),
];

const communityLinks = [
  { href: "/code-of-conduct", label: "Code of Conduct" },
  { href: "/organizers", label: "Organizers" },
  { href: "/faq", label: "FAQ" },
];

export function Footer() {
  const { social } = siteConfig;

  return (
    <footer className="border-hairline bg-surface border-t">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 py-14 sm:grid-cols-2 sm:px-8 lg:grid-cols-4">
        <div className="sm:col-span-2 lg:col-span-1">
          <Logo />
          <p className="text-ink-muted mt-4 max-w-xs text-sm leading-relaxed">
            {siteConfig.event.tagline}. Organized by volunteers from the {siteConfig.organizer.name}
            .
          </p>
          <p className="mono-data text-ink-muted mt-4">
            {siteConfig.event.dateDisplay} · {siteConfig.event.city}
          </p>
        </div>

        <FooterColumn title="Event" links={eventLinks} />
        <FooterColumn title="Community" links={communityLinks} />

        <div>
          <h2 className="mono-data text-neon-teal mb-4">Connect</h2>
          <ul className="space-y-2.5 text-sm">
            <li>
              <Link href="/contact" className="text-ink-muted hover:text-ink transition-colors">
                Contact
              </Link>
            </li>
            {social.twitter && (
              <li>
                <a
                  href={social.twitter}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-ink-muted hover:text-ink transition-colors"
                >
                  X / Twitter
                </a>
              </li>
            )}
            {social.linkedin && (
              <li>
                <a
                  href={social.linkedin}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-ink-muted hover:text-ink transition-colors"
                >
                  LinkedIn
                </a>
              </li>
            )}
            <li>
              <a
                href={`mailto:${siteConfig.organizer.contactEmail}`}
                className="text-ink-muted hover:text-ink transition-colors"
              >
                {siteConfig.organizer.contactEmail}
              </a>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-hairline border-t">
        <div className="text-ink-muted mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-2 px-5 py-5 text-xs sm:flex-row sm:px-8">
          <p>
            © {new Date().getFullYear()} {siteConfig.organizer.name}. All rights reserved.
          </p>
          <p className="mono-data">
            PostgreSQL is a trademark of the PostgreSQL Global Development Group.
          </p>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: { href: string; label: string }[];
}) {
  return (
    <nav aria-label={title}>
      <h2 className="mono-data text-neon-teal mb-4">{title}</h2>
      <ul className="space-y-2.5 text-sm">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className="text-ink-muted hover:text-ink transition-colors">
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
