import Link from "next/link";
import { siteConfig } from "@/lib/config";

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
    <footer className="bg-pg-blue-dark border-pg-blue border-t-2">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 py-12 sm:grid-cols-2 sm:px-8 lg:grid-cols-4">
        <div className="sm:col-span-2 lg:col-span-1">
          <FooterLogo />
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-white/90">
            {siteConfig.event.tagline}. Organized by volunteers from the {siteConfig.organizer.name}
            .
          </p>
          <p className="mt-4 text-sm text-white/80">
            {siteConfig.event.dateDisplay} · {siteConfig.event.city}
          </p>
        </div>

        <FooterColumn title="Event" links={eventLinks} />
        <FooterColumn title="Community" links={communityLinks} />

        <nav aria-label="Connect">
          <h2 className="mb-4 text-sm font-semibold text-white">Connect</h2>
          <ul className="space-y-2 text-sm">
            <li>
              <Link href="/contact" className="text-white/90 hover:text-white">
                Contact
              </Link>
            </li>
            {social.twitter && (
              <li>
                <a
                  href={social.twitter}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-white/90 hover:text-white"
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
                  className="text-white/90 hover:text-white"
                >
                  LinkedIn
                </a>
              </li>
            )}
            <li>
              <a
                href={`mailto:${siteConfig.organizer.contactEmail}`}
                className="text-white/90 hover:text-white"
              >
                {siteConfig.organizer.contactEmail}
              </a>
            </li>
          </ul>
        </nav>
      </div>

      <div className="bg-pg-blue-dark border-pg-blue/40 border-t">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-2 px-5 py-4 text-xs text-white/80 sm:flex-row sm:px-8">
          <p>
            © {new Date().getFullYear()} {siteConfig.organizer.name}. All rights reserved.
          </p>
          <p className="text-sm">
            PostgreSQL is a trademark of the PostgreSQL Global Development Group.
          </p>
        </div>
      </div>
    </footer>
  );
}

function FooterLogo() {
  return (
    <Link href="/" className="inline-flex items-center gap-2.5">
      <svg aria-hidden="true" viewBox="0 0 32 32" className="size-7 shrink-0" fill="none">
        <rect
          x="1"
          y="1"
          width="30"
          height="30"
          rx="2"
          className="fill-pg-blue-dark stroke-pg-blue/60"
        />
        <path
          d="M10.5 12.5c0-1.66 2.46-3 5.5-3s5.5 1.34 5.5 3-2.46 3-5.5 3-5.5-1.34-5.5-3Z"
          className="stroke-white"
          strokeWidth="1.8"
        />
        <path
          d="M10.5 12.5v7c0 1.66 2.46 3 5.5 3s5.5-1.34 5.5-3v-7"
          className="stroke-white"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <path
          d="M21 14.5v0M21 19.5v0"
          className="stroke-white"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
      </svg>
      <span className="flex flex-col leading-none">
        <span className="text-[15px] font-bold tracking-tight text-white">PG Day Egypt</span>
        <span className="mt-0.5 text-[10px] text-white/80">2026</span>
      </span>
    </Link>
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
      <h2 className="mb-4 text-sm font-semibold text-white">{title}</h2>
      <ul className="space-y-2 text-sm">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className="text-white/90 hover:text-white">
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
