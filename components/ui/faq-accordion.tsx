"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { renderFaqAnswer } from "@/components/ui/faq-answer";

export function FaqAccordion({
  items,
}: {
  items: { id: string; question: string; answer: string }[];
}) {
  const [openId, setOpenId] = useState<string | null>(items[0]?.id ?? null);

  return (
    <div className="divide-hairline border-hairline bg-surface/60 mx-auto max-w-3xl divide-y rounded-xl border">
      {items.map((item) => {
        const open = openId === item.id;
        return (
          <div key={item.id}>
            <h2>
              <button
                type="button"
                onClick={() => setOpenId(open ? null : item.id)}
                aria-expanded={open}
                aria-controls={`faq-panel-${item.id}`}
                id={`faq-button-${item.id}`}
                className="hover:bg-surface-raised/60 flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors sm:px-6 sm:py-5"
              >
                <span className="font-display text-ink text-base font-semibold sm:text-lg">
                  {item.question}
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className={cn(
                    "text-neon-teal size-4 shrink-0 transition-transform duration-200",
                    open && "rotate-180"
                  )}
                />
              </button>
            </h2>
            <div
              id={`faq-panel-${item.id}`}
              role="region"
              aria-labelledby={`faq-button-${item.id}`}
              hidden={!open}
              className="px-5 pb-5 sm:px-6"
            >
              <p className="text-ink-muted max-w-2xl text-sm leading-relaxed sm:text-base">
                {renderFaqAnswer(item.answer)}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
