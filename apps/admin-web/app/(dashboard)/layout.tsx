import type { ReactNode } from "react";
import { Nav } from "@/components/nav";

/**
 * Dashboard shell — sidebar nav + content.
 * Responsive: sidebar drawer on <lg, fixed sidebar on ≥lg.
 * No direct DB import — nav fetches RBAC via /api/auth/me (React Query).
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-[calc(100dvh-3.5rem)] w-full max-w-[1600px] flex-col lg:flex-row">
      <Nav />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </div>
        <footer className="border-hairline text-ink-muted admin-label border-t px-4 py-3 text-center text-xs sm:px-6 lg:px-8">
          PG Day Egypt — Admin
        </footer>
      </div>
    </div>
  );
}
