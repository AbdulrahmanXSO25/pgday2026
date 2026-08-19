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
  { href: "/venue", label: "Venue" },
  ...(siteConfig.features.showSponsors ? [{ href: "/sponsors", label: "Sponsors" }] : []),
] as const;

export function Header() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="border-hairline bg-void/85 sticky top-0 z-50 border-b backdrop-blur-md">
      <nav
        aria-label="Main"
        className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-8"
      >
        <Logo />

        <ul className="hidden items-center gap-1 md:flex">
          {mainLinks.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                aria-current={isActive(link.href) ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive(link.href)
                    ? "text-neon-teal decoration-neon-teal/70 underline underline-offset-8"
                    : "text-ink-muted hover:text-ink"
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
              "bg-neon-teal text-void inline-flex items-center rounded-full px-5 py-2 text-sm font-semibold transition-all hover:shadow-[0_0_20px_rgb(46_230_210/0.4)]",
              pathname === "/register" && "ring-neon-teal/50 ring-offset-void ring-2 ring-offset-2"
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
          className="text-ink-muted hover:text-ink rounded-md p-2 md:hidden"
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </nav>

      {open && (
        <div id="mobile-menu" className="border-hairline bg-void border-t md:hidden">
          <ul className="mx-auto flex w-full max-w-6xl flex-col gap-1 px-5 py-4">
            {mainLinks.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  onClick={() => setOpen(false)}
                  aria-current={isActive(link.href) ? "page" : undefined}
                  className={cn(
                    "block rounded-md px-3 py-2.5 text-base font-medium",
                    isActive(link.href)
                      ? "bg-surface-raised text-neon-teal"
                      : "text-ink-muted hover:text-ink"
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
                className="bg-neon-teal text-void block rounded-full px-5 py-2.5 text-center text-base font-semibold"
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
