"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const QUERY_LINES = ["$ SELECT * FROM community", "  WHERE country = 'Egypt' AND year = 2026;"];

export function TypedQuery({ className }: { className?: string }) {
  const [lines, setLines] = useState<string[]>(["", ""]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const id = setTimeout(() => {
        setLines(QUERY_LINES);
      }, 0);
      return () => clearTimeout(id);
    }

    const full = QUERY_LINES.join("");
    let i = 0;
    let raf = 0;
    let last = 0;
    const interval = 28;

    const tick = (ts: number) => {
      if (ts - last >= interval) {
        last = ts;
        i += 1;
        const partial = full.slice(0, i);
        setLines(partial.split("\n"));
        if (i >= full.length) {
          return;
        }
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <pre
      aria-label="A query selecting the PostgreSQL community in Egypt, 2026"
      className={cn(
        "overflow-x-auto p-5 font-mono text-[13px] leading-relaxed sm:p-6 sm:text-sm",
        className
      )}
    >
      {lines.map((line, idx) => (
        <div key={idx} className="whitespace-pre-wrap">
          {idx === 0 && <span className="text-neon-teal">{"> "}</span>}
          <span className="text-ink">{line}</span>
          {idx === lines.length - 1 && (
            <span
              aria-hidden="true"
              className="bg-neon-teal animate-blink ml-0.5 inline-block h-[1.05em] w-[0.6em] translate-y-[0.2em]"
            />
          )}
        </div>
      ))}
    </pre>
  );
}
