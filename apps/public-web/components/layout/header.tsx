"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { siteConfig } from "@/lib/config";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/ui/logo";

const mainLinks = [
  { href: "/about", label: "About" },
  { href: "/schedule", label: "Schedule" },
  { href: "/speakers", label: "Speakers" },
  { href: "/cfp", label: "Call for Papers" },
  { href: "/venue", label: "Venue" },
  ...(siteConfig.features.showSponsors ? [{ href: "/sponsors", label: "Sponsors" }] : []),
] as const;

export function Header() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="bg-surface border-pg-blue sticky top-0 z-50 border-b-2">
      <nav
        aria-label="Main"
        className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-5 sm:px-8"
      >
        <Logo />

        <ul className="hidden items-center gap-1 md:flex">
          {mainLinks.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                aria-current={isActive(link.href) ? "page" : undefined}
                className={cn(
                  "px-3 py-2 text-sm",
                  isActive(link.href)
                    ? "text-pg-blue decoration-pg-blue/60 font-semibold underline underline-offset-4"
                    : "text-ink hover:text-pg-blue"
                )}
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="hidden md:block">
          <Link
            href="/register"
            className={cn(
              "border-pg-blue bg-pg-blue hover:bg-pg-blue-dark inline-flex items-center rounded-sm border px-4 py-1.5 text-sm font-semibold text-white transition-colors",
              pathname === "/register" && "ring-pg-blue/30 ring-offset-surface ring-2 ring-offset-2"
            )}
          >
            Register
          </Link>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? "Close menu" : "Open menu"}
          className="text-ink-muted hover:text-ink rounded-sm p-2 md:hidden"
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </nav>

      {open && (
        <div id="mobile-menu" className="border-hairline bg-surface border-t md:hidden">
          <ul className="mx-auto flex w-full max-w-6xl flex-col gap-1 px-5 py-4">
            {mainLinks.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  onClick={() => setOpen(false)}
                  aria-current={isActive(link.href) ? "page" : undefined}
                  className={cn(
                    "block px-3 py-2 text-base",
                    isActive(link.href)
                      ? "bg-surface-raised text-pg-blue font-semibold"
                      : "text-ink hover:text-pg-blue"
                  )}
                >
                  {link.label}
                </Link>
              </li>
            ))}
            <li className="mt-2">
              <Link
                href="/register"
                onClick={() => setOpen(false)}
                className="border-pg-blue bg-pg-blue block rounded-sm border px-5 py-2 text-center text-base font-semibold text-white"
              >
                Register to Attend
              </Link>
            </li>
          </ul>
        </div>
      )}
    </header>
  );
}
