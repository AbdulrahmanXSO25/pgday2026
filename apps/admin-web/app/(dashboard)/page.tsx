import Link from "next/link";

/**
 * Admin dashboard — real overview (counts from API + quick links).
 * Static shell; counts hydrate client-side in nav-independent fashion.
 */
import { DashboardStats } from "./dashboard-stats";

export default function AdminHome() {
  return (
    <div className="w-full">
      <p className="admin-label text-pg-blue mb-2">Organizer dashboard</p>
      <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
      <p className="text-ink-muted mt-3 max-w-xl leading-relaxed">
        Welcome to the PG Day Egypt organizer area. Changes you make here only appear on the public
        website after you{" "}
        <Link href="/settings" className="text-pg-blue underline">
          publish them
        </Link>
        .
      </p>

      <DashboardStats />

      <div className="mt-8 grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-3">
        {[
          { href: "/speakers", label: "Speakers", note: "drafts & published" },
          { href: "/sessions", label: "Sessions", note: "talks, breaks, logistics" },
          { href: "/schedule", label: "Schedule", note: "day timeline" },
          { href: "/sponsors", label: "Sponsors", note: "tiers + visibility" },
          { href: "/registrations", label: "Registrations", note: "filter + status" },
          { href: "/cfp", label: "CFP", note: "review inbox" },
          { href: "/media", label: "Media", note: "photos & files" },
          { href: "/check-in", label: "Check-in", note: "event-day check-in" },
          { href: "/users", label: "Team", note: "members & access" },
          { href: "/settings", label: "Settings", note: "event details & publishing" },
          { href: "/audit-log", label: "Activity log", note: "history of all changes" },
        ].map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="card hover:border-pg-blue rounded-sm border p-4 transition-colors"
          >
            <p className="text-ink text-sm font-semibold">{l.label}</p>
            <p className="admin-label text-ink-muted mt-1 text-[11px]">{l.note}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
