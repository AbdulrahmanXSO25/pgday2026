"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Mic2,
  CalendarDays,
  HeartHandshake,
  ClipboardList,
  Image as ImageIcon,
  FileText,
  Settings2,
  LogOut,
  ShieldCheck,
  Menu,
  X,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { apiFetch, logout as apiLogout, type MeResponse } from "@/lib/api";
import { roleLabel } from "@/lib/format";
import { cn } from "@pgegypt/ui";
import type { Permission } from "@pgegypt/auth";

function hasPermission(role: string, permissions: string[], required: Permission): boolean {
  if (role === "SUPER_ADMIN") return true;
  if ((permissions as string[]).includes(required)) return true;
  if (required.endsWith(":READ")) {
    const write = required.replace(":READ", ":WRITE") as Permission;
    if ((permissions as string[]).includes(write)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Nav config — single source of RBAC truth
// Each entry declares the minimum permission required to be visible.
// SUPER_ADMIN bypasses checks via hasPermission (all-access).
// ---------------------------------------------------------------------------

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  permission?: Permission; // undefined => always visible (e.g. dashboard)
  exact?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/speakers", label: "Speakers", icon: Mic2, permission: "speakers:READ" },
  { href: "/sessions", label: "Sessions", icon: CalendarDays, permission: "sessions:READ" },
  { href: "/schedule", label: "Schedule", icon: CalendarDays, permission: "sessions:READ" },
  { href: "/settings", label: "Settings", icon: Settings2, permission: "publishing:READ" },
  { href: "/audit-log", label: "Audit log", icon: ShieldCheck, permission: undefined },
  { href: "/sponsors", label: "Sponsors", icon: HeartHandshake, permission: "sponsors:READ" },
  {
    href: "/registrations",
    label: "Registrations",
    icon: ClipboardList,
    permission: "registrations:READ",
  },
  { href: "/cfp", label: "CFP", icon: FileText, permission: "cfp:READ" },
  { href: "/media", label: "Media", icon: ImageIcon, permission: "media:READ" },
  { href: "/users", label: "Users", icon: Users, permission: "users:READ" },
];

function canSee(item: NavItem, role: string, permissions: string[]): boolean {
  if (!item.permission) return true;
  return hasPermission(role as never, permissions as Permission[], item.permission);
}

// ---------------------------------------------------------------------------
// Data hook — fetches /v1/auth/me via same-origin proxy
// ---------------------------------------------------------------------------

function useMe() {
  return useQuery({
    queryKey: ["auth", "me"],
    queryFn: async () => {
      const res = await apiFetch<{ success: true; data: MeResponse }>("/auth/me", {
        method: "GET",
      });
      return res.data;
    },
    staleTime: 60 * 1000,
    retry: false,
  });
}

// ---------------------------------------------------------------------------
// Nav — responsive: sidebar on desktop, collapsible drawer on mobile
// ---------------------------------------------------------------------------

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { data, isLoading, isError } = useMe();

  const user = data?.user;
  const role = user?.role ?? "ADMIN";
  const permissions = user?.permissions ?? [];

  const visibleItems = useMemo(
    () => NAV_ITEMS.filter((it) => canSee(it, role, permissions)),
    [role, permissions]
  );

  const logoutMut = useMutation({
    mutationFn: () => apiLogout(),
    onSettled: async () => {
      // Clear query cache and redirect — cookie cleared by API
      qc.clear();
      router.push("/login");
      router.refresh();
    },
  });

  const isActive = (href: string, exact?: boolean) => {
    if (exact) return pathname === href;
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <>
      {/* Mobile top bar */}
      <div className="bg-surface border-hairline flex h-14 items-center justify-between border-b px-4 lg:hidden">
        <span className="text-ink flex items-center gap-2 text-sm font-bold">
          <span className="bg-pg-blue inline-flex size-7 items-center justify-center rounded-sm text-white">
            <ShieldCheck className="size-4" />
          </span>
          PG Admin
        </span>
        <button
          type="button"
          aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((v) => !v)}
          className="border-hairline bg-surface inline-flex size-9 items-center justify-center rounded-sm border"
        >
          {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>

      {/* Sidebar + overlay */}
      <div
        className={cn(
          "fixed inset-0 z-40 flex lg:static lg:inset-auto",
          mobileOpen ? "visible" : "invisible lg:visible"
        )}
      >
        {/* overlay */}
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
          className={cn(
            "bg-ink/20 flex-1 backdrop-blur-[1px] transition-opacity lg:hidden",
            mobileOpen ? "opacity-100" : "opacity-0"
          )}
        />

        {/* panel */}
        <nav
          aria-label="Primary"
          className={cn(
            "bg-surface border-hairline flex h-dvh w-[78%] max-w-[300px] shrink-0 flex-col border-r transition-transform duration-200 ease-out lg:h-auto lg:w-64 lg:translate-x-0 lg:transition-none",
            mobileOpen ? "translate-x-0" : "-translate-x-full"
          )}
        >
          {/* brand — desktop only (mobile has top bar) */}
          <div className="border-hairline hidden h-14 shrink-0 items-center gap-3 border-b px-5 lg:flex">
            <span className="bg-pg-blue inline-flex size-8 items-center justify-center rounded-sm text-white">
              <ShieldCheck className="size-4.5" />
            </span>
            <div className="min-w-0">
              <p className="text-ink text-sm leading-none font-bold">PG Day Egypt</p>
              <p className="admin-label text-ink-muted text-[11px]">Organizers</p>
            </div>
            <button
              type="button"
              aria-label="Close navigation"
              onClick={() => setMobileOpen(false)}
              className="ml-auto inline-flex size-8 items-center justify-center rounded-sm lg:hidden"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* user summary */}
          <div className="border-hairline border-b px-4 py-3">
            {isLoading ? (
              <div className="space-y-2">
                <div className="bg-surface-raised h-3 w-28 animate-pulse rounded" />
                <div className="bg-surface-raised h-2.5 w-20 animate-pulse rounded" />
              </div>
            ) : isError || !user ? (
              <p className="admin-label text-ink-muted text-xs">Not signed in</p>
            ) : (
              <div className="min-w-0">
                <p className="text-ink truncate text-sm font-semibold">
                  {user.displayName ?? user.email}
                </p>
                <p className="admin-label text-ink-muted truncate text-xs">
                  {roleLabel(user.role)}
                </p>
              </div>
            )}
          </div>

          {/* links */}
          <div className="flex-1 overflow-y-auto px-2 py-3">
            <ul className="space-y-1" role="list">
              {visibleItems.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href, item.exact);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-3 rounded-sm px-3 py-2 text-sm font-medium transition-colors",
                        active
                          ? "bg-pg-blue text-white"
                          : "text-ink hover:bg-surface-raised hover:text-ink"
                      )}
                    >
                      <Icon
                        className={cn("size-4 shrink-0", active ? "text-white" : "text-ink-muted")}
                      />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>

            {isLoading ? null : visibleItems.length === 1 ? (
              <p className="admin-label text-ink-muted mt-4 px-3 text-xs leading-relaxed">
                Limited access — ask a super admin for more access.
              </p>
            ) : null}
          </div>

          {/* footer */}
          <div className="border-hairline border-t p-3">
            <button
              type="button"
              onClick={() => logoutMut.mutate()}
              disabled={logoutMut.isPending}
              className="border-hairline bg-surface text-ink hover:bg-surface-raised inline-flex w-full items-center justify-center gap-2 rounded-sm border px-3 py-2 text-sm font-medium disabled:opacity-50"
            >
              <LogOut className="size-4" />
              {logoutMut.isPending ? "Signing out…" : "Sign out"}
            </button>
            <p className="admin-label text-ink-muted mt-2 text-center text-[11px]">
              PG Day Egypt · Organizers
            </p>
          </div>
        </nav>
      </div>
    </>
  );
}

export default Nav;
