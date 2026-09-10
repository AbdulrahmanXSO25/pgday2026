import type { ScheduleItem } from "@/lib/content";
import { getSpeaker } from "@/lib/content";
import { Badge } from "@/components/ui/badge";

export function ScheduleRow({ item }: { item: ScheduleItem }) {
  const speakers = item.speakerIds.map(getSpeaker).filter(Boolean);

  return (
    <div className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="mono-data text-ink-muted shrink-0 text-xs">
        {item.start} — {item.end}
      </div>
      <div className="flex-1 sm:ml-6">
        <h3 className="text-pg-blue text-base font-semibold">{item.title}</h3>
        {item.abstract && (
          <p className="text-ink-muted mt-1 text-sm leading-relaxed">{item.abstract}</p>
        )}
        {speakers.length > 0 && (
          <p className="mono-data text-ink-muted mt-2">{speakers.map((s) => s!.name).join(", ")}</p>
        )}
      </div>
      <Badge
        variant={item.type === "talk" || item.type === "keynote" ? "blue" : "neutral"}
        className="self-start"
      >
        {item.type}
      </Badge>
    </div>
  );
}
