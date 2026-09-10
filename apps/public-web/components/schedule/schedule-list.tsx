import type { ScheduleItem } from "@/lib/content";
import { ScheduleRow } from "./schedule-row";

export function ScheduleList({ items, limit }: { items: ScheduleItem[]; limit?: number }) {
  const visible = limit ? items.slice(0, limit) : items;
  return (
    <div className="space-y-3">
      {visible.map((item) => (
        <ScheduleRow key={item.id} item={item} />
      ))}
    </div>
  );
}
