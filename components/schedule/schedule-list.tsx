import { schedule, type ScheduleItem } from "@/lib/content";
import { ScheduleRow } from "@/components/schedule/schedule-row";

export function ScheduleList({
  items = schedule,
  limit,
  showAbstract = true,
}: {
  items?: ScheduleItem[];
  limit?: number;
  showAbstract?: boolean;
}) {
  const visible = limit ? items.slice(0, limit) : items;

  return (
    <ol className="divide-hairline border-hairline bg-surface divide-y border">
      {visible.map((session) => (
        <ScheduleRow
          key={session.id}
          session={session}
          index={items.indexOf(session)}
          showAbstract={showAbstract}
        />
      ))}
    </ol>
  );
}
