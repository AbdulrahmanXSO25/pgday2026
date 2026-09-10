import type { ReactNode } from "react";
import { cn } from "../lib/utils";

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
    <section className={cn("border-hairline bg-surface relative border-b", className)}>
      <div className="mx-auto w-full max-w-6xl px-5 pt-12 pb-12 sm:px-8 sm:pt-14 sm:pb-14">
        {eyebrow && <p className="mono-data text-pg-blue mb-3">{eyebrow}</p>}
        <h1 className="max-w-3xl text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
        {description && (
          <p className="text-ink-muted mt-3 max-w-2xl text-base leading-relaxed">{description}</p>
        )}
        {children}
      </div>
    </section>
  );
}
