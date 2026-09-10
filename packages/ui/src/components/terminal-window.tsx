import type { ReactNode } from "react";
import { cn } from "../lib/utils";

function TypedQueryInline() {
  return (
    <pre className="overflow-x-auto p-5 font-mono text-[13px] leading-relaxed sm:p-6 sm:text-sm">
      <div className="whitespace-pre-wrap">
        <span className="text-pg-blue">{"> "}</span>
        <span className="text-ink">{"$ SELECT * FROM community"}</span>
      </div>
      <div className="whitespace-pre-wrap">
        <span className="text-ink">{"  WHERE country = 'Egypt' AND year = 2026;"}</span>
        <span
          aria-hidden="true"
          className="bg-pg-blue animate-blink ml-0.5 inline-block h-[1.05em] w-[0.6em] translate-y-[0.2em]"
        />
      </div>
    </pre>
  );
}

export function TerminalWindow({
  title = "psql",
  children,
  className,
  query,
}: {
  title?: string;
  children?: ReactNode;
  className?: string;
  query?: boolean;
}) {
  return (
    <div className={cn("border-hairline bg-surface border", className)}>
      <div className="bg-pg-blue border-pg-blue flex items-center gap-2 border-b px-3 py-1.5">
        <span aria-hidden="true" className="mono-data text-white">
          {title}
        </span>
      </div>
      {query ? <TypedQueryInline /> : <div className="p-4 sm:p-5">{children}</div>}
    </div>
  );
}
