import Link from "next/link";
import { cn } from "@/lib/utils";
import { getSpeaker, sessionTypeLabels, type ScheduleItem } from "@/lib/content";
import { Badge } from "@/components/ui/badge";

const levelVariant = {
  beginner: "violet",
  intermediate: "blue",
  advanced: "amber",
} as const;

export function ScheduleRow({
  session,
  showAbstract = true,
  index,
}: {
  session: ScheduleItem;
  showAbstract?: boolean;
  index?: number;
}) {
  const isLogistics = session.type === "break" || session.type === "logistics";
  const speakers = session.speakerIds.map(getSpeaker).filter((s) => s !== undefined);

  return (
    <li
      id={session.id}
      className="group hover:border-pg-blue hover:bg-surface-raised flex gap-4 border-l-2 border-transparent px-4 py-3.5 sm:gap-6 sm:px-5"
    >
      <div className="mono-data text-ink-muted w-[4.5rem] shrink-0 pt-0.5 sm:w-[6.5rem]">
        <span className="text-pg-blue">{session.start}</span>
        <span aria-hidden="true" className="mx-1">
          –
        </span>
        <span>{session.end}</span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h3
            className={cn(
              "text-base leading-snug font-semibold sm:text-lg",
              isLogistics ? "text-ink-muted" : "text-ink"
            )}
          >
            {session.title}
          </h3>
          {!isLogistics && (
            <Badge variant="neutral" className="normal-case">
              {sessionTypeLabels[session.type]}
            </Badge>
          )}
          {session.level && <Badge variant={levelVariant[session.level]}>{session.level}</Badge>}
        </div>

        {speakers.length > 0 && (
          <p className="text-ink-muted mt-1 text-sm">
            {speakers.map((speaker, i) => (
              <span key={speaker.id}>
                {i > 0 && ", "}
                <Link
                  href={`/speakers/${speaker.id}`}
                  className="text-pg-blue font-semibold underline-offset-4 hover:underline"
                >
                  {speaker.name}
                </Link>
                <span> · {speaker.company}</span>
              </span>
            ))}
          </p>
        )}

        {showAbstract && session.abstract && (
          <p className="text-ink-muted mt-1.5 text-sm leading-relaxed">{session.abstract}</p>
        )}
      </div>

      {index !== undefined && (
        <span
          aria-hidden="true"
          className="mono-data text-ink-muted group-hover:text-pg-blue hidden pt-0.5 text-[10px] lg:block"
        >
          ({index + 1})
        </span>
      )}
    </li>
  );
}
