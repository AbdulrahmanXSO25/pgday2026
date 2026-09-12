import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type BadgeVariant = "blue" | "amber" | "violet" | "neutral";

const variantStyles: Record<BadgeVariant, string> = {
  blue: "border-pg-blue/50 text-pg-blue",
  amber: "border-pg-amber/60 text-pg-amber",
  violet: "border-pg-violet/60 text-pg-violet",
  neutral: "border-hairline text-ink-muted",
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
        "bg-surface inline-flex items-center rounded-sm border px-1.5 py-px text-xs font-medium uppercase",
        variantStyles[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
