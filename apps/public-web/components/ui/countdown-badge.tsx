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
    <span className={cn("mono-data text-pg-blue inline-block", className)}>
      {days === null ? (
        "days_remaining: --"
      ) : days > 0 ? (
        <>days_remaining: {days}</>
      ) : (
        <span className="text-pg-amber">-- event day --</span>
      )}
    </span>
  );
}
