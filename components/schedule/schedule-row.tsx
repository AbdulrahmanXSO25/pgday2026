import Link from "next/link";
import { cn } from "@/lib/utils";
import { getSpeaker, sessionTypeLabels, type ScheduleItem } from "@/lib/content";
import { Badge } from "@/components/ui/badge";

const levelVariant = {
  beginner: "violet",
  intermediate: "teal",
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
      className="group hover:border-neon-teal hover:bg-surface-raised relative flex gap-4 rounded-lg border-l-2 border-transparent p-4 transition-colors sm:gap-6 sm:p-5"
    >
      <div className="mono-data text-ink-muted w-[4.5rem] shrink-0 pt-1 sm:w-[6.5rem]">
        <span className="text-neon-teal/70">{session.start}</span>
        <span aria-hidden="true" className="mx-1">
          –
        </span>
        <span>{session.end}</span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h3
            className={cn(
              "font-display text-base leading-snug font-semibold sm:text-lg",
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
          <p className="text-ink-muted mt-1.5 text-sm">
            {speakers.map((speaker, i) => (
              <span key={speaker.id}>
                {i > 0 && ", "}
                <Link
                  href={`/speakers/${speaker.id}`}
                  className="text-neon-teal font-medium underline-offset-4 hover:underline"
                >
                  {speaker.name}
                </Link>
                <span> · {speaker.company}</span>
              </span>
            ))}
          </p>
        )}

        {showAbstract && session.abstract && (
          <p className="text-ink-muted mt-2 text-sm leading-relaxed">{session.abstract}</p>
        )}
      </div>

      {index !== undefined && (
        <span
          aria-hidden="true"
          className="mono-data text-ink-muted/40 group-hover:text-neon-teal/60 absolute top-2 right-3 hidden text-[10px] lg:block"
        >
          ({index + 1})
        </span>
      )}
    </li>
  );
}
