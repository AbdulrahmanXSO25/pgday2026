import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type BadgeVariant = "teal" | "amber" | "violet" | "neutral";

const variantStyles: Record<BadgeVariant, string> = {
  teal: "border-neon-teal/40 bg-neon-teal/10 text-neon-teal",
  amber: "border-neon-amber/40 bg-neon-amber/10 text-neon-amber",
  violet: "border-neon-violet/40 bg-neon-violet/10 text-neon-violet",
  neutral: "border-hairline bg-surface-raised text-ink-muted",
};

export function Badge({
  variant = "neutral",
  className,
  children,
}: {
  variant?: BadgeVariant;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "mono-data inline-flex items-center rounded-full border px-2.5 py-0.5 font-medium uppercase",
        variantStyles[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
