"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

function getDaysRemaining(dateISO: string): number {
  const now = new Date();
  const target = new Date(dateISO);
  const nowUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const targetUtc = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());
  return Math.max(0, Math.round((targetUtc - nowUtc) / 86400000));
}

export function CountdownBadge({ dateISO, className }: { dateISO: string; className?: string }) {
  const [days, setDays] = useState<number | null>(null);

  useEffect(() => {
    const update = () => setDays(getDaysRemaining(dateISO));
    const id = setTimeout(update, 0);
    const interval = setInterval(update, 60 * 60 * 1000);
    return () => {
      clearTimeout(id);
      clearInterval(interval);
    };
  }, [dateISO]);

  return (
    <span
      className={cn(
        "mono-data border-hairline bg-surface text-ink-muted inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5",
        className
      )}
    >
      {days === null ? (
        <span className="text-neon-teal">days_remaining: --</span>
      ) : days > 0 ? (
        <>
          <span className="text-neon-teal">days_remaining: {days}</span>
          {days <= 30 && (
            <span
              aria-hidden="true"
              className="bg-neon-amber size-1.5 animate-pulse rounded-full"
            />
          )}
        </>
      ) : (
        <span className="text-neon-amber">-- event day --</span>
      )}
    </span>
  );
}
