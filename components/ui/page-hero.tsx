import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHero({
  eyebrow,
  title,
  description,
  children,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn("grid-texture border-hairline relative overflow-hidden border-b", className)}
    >
      <div
        aria-hidden="true"
        className="bg-neon-teal/8 pointer-events-none absolute -top-32 left-1/2 h-64 w-[36rem] -translate-x-1/2 rounded-full blur-3xl"
      />
      <div className="relative mx-auto w-full max-w-6xl px-5 pt-16 pb-14 sm:px-8 sm:pt-20 sm:pb-16">
        {eyebrow && <p className="mono-data text-neon-teal mb-3">{eyebrow}</p>}
        <h1 className="font-display text-ink max-w-3xl text-4xl leading-[1.1] font-bold tracking-tight sm:text-5xl">
          {title}
        </h1>
        {description && (
          <p className="text-ink-muted mt-4 max-w-2xl text-base leading-relaxed sm:text-lg">
            {description}
          </p>
        )}
        {children}
      </div>
    </section>
  );
}
