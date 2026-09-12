import Link from "next/link";
import type { ScheduleItem } from "@/lib/content";
import { getSpeaker } from "@/lib/content";
import { Badge } from "@/components/ui/badge";
import { formatTimeRange } from "@/lib/dates";

export function ScheduleRow({ item }: { item: ScheduleItem }) {
  const speakers = item.speakerIds.map(getSpeaker).filter(Boolean);

  return (
    <Link
      href={`/schedule/detail?id=${item.id}`}
      className="card hover:border-pg-blue group flex flex-col gap-3 p-4 transition-colors sm:flex-row sm:items-start sm:justify-between"
    >
      <div className="text-ink-muted shrink-0 text-sm font-medium tabular-nums">
        {formatTimeRange(item.start, item.end)}
      </div>
      <div className="flex-1 sm:ml-6">
        <h3 className="text-pg-blue text-base font-semibold group-hover:underline">{item.title}</h3>
        {item.abstract && (
          <p className="text-ink-muted mt-1 line-clamp-2 text-sm leading-relaxed">
            {item.abstract}
          </p>
        )}
        {speakers.length > 0 && (
          <p className="text-ink-muted mt-2 text-sm">{speakers.map((s) => s!.name).join(", ")}</p>
        )}
      </div>
      <Badge
        variant={item.type === "talk" || item.type === "keynote" ? "blue" : "neutral"}
        className="self-start"
      >
        {item.type}
      </Badge>
    </Link>
  );
}
