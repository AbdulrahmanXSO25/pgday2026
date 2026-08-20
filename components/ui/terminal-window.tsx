import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { TypedQuery } from "@/components/ui/typed-query";

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
      {query ? <TypedQuery /> : <div className="p-4 sm:p-5">{children}</div>}
    </div>
  );
}
