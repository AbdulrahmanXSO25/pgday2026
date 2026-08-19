import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { TypedQuery } from "@/components/ui/typed-query";

export function TerminalWindow({
  title = "psql — pgegypt.org",
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
    <div
      className={cn(
        "border-hairline bg-surface-raised overflow-hidden rounded-xl border shadow-[0_24px_60px_-24px_rgb(0_0_0/0.8),inset_0_1px_0_rgb(255_255_255/0.04)]",
        className
      )}
    >
      <div className="border-hairline bg-surface flex items-center gap-2 border-b px-4 py-2.5">
        <span aria-hidden="true" className="size-3 rounded-full bg-[#ff5f57]" />
        <span aria-hidden="true" className="size-3 rounded-full bg-[#febc2e]" />
        <span aria-hidden="true" className="size-3 rounded-full bg-[#28c840]" />
        <span className="mono-data text-ink-muted ml-3 truncate">{title}</span>
      </div>
      {query ? <TypedQuery /> : <div className="p-5 sm:p-6">{children}</div>}
    </div>
  );
}
