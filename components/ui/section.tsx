import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Section({
  id,
  children,
  className,
  texture = false,
}: {
  id?: string;
  children: ReactNode;
  className?: string;
  texture?: boolean;
}) {
  return (
    <section
      id={id}
      className={cn(
        "relative mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 sm:py-20",
        texture && "grid-texture",
        className
      )}
    >
      {children}
    </section>
  );
}

export function SectionHeader({
  eyebrow,
  title,
  description,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  className?: string;
}) {
  return (
    <div className={cn("mb-10 max-w-2xl sm:mb-12", className)}>
      {eyebrow && <p className="mono-data text-neon-teal mb-3">{eyebrow}</p>}
      <h2 className="font-display text-ink text-3xl font-bold tracking-tight sm:text-4xl">
        {title}
      </h2>
      {description && (
        <p className="text-ink-muted mt-4 text-base leading-relaxed sm:text-lg">{description}</p>
      )}
    </div>
  );
}
