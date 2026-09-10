import Link from "next/link";
import type { Speaker } from "@/lib/content";
import { getSession } from "@/lib/content";
import { cn } from "@/lib/utils";
import { LinkedInIcon, XIcon } from "@/components/ui/social-icons";

export function SpeakerCard({
  speaker,
  className,
  priority = false,
}: {
  speaker: Speaker;
  className?: string;
  priority?: boolean;
}) {
  void priority;
  const session = getSession(speaker.talkId);

  return (
    <article
      className={cn(
        "card card-hover group focus-within:outline-pg-blue relative flex flex-col focus-within:outline-2 focus-within:outline-offset-2",
        className
      )}
    >
      <Link
        href={`/speakers/${speaker.id}`}
        tabIndex={-1}
        aria-hidden="true"
        className="border-hairline bg-surface-raised relative block aspect-square border-b"
      >
        {}
        <img
          src={speaker.photo}
          alt={`Portrait of ${speaker.name}`}
          className="h-full w-full object-cover"
        />
      </Link>

      <div className="flex flex-1 flex-col p-4">
        <h3 className="text-base font-bold">
          <Link href={`/speakers/${speaker.id}`} className="hover:text-pg-blue">
            <span aria-hidden="true" className="absolute inset-0" />
            {speaker.name}
          </Link>
        </h3>
        <p className="mono-data text-ink-muted mt-1">
          {speaker.role} · {speaker.company}
        </p>

        {session && (
          <p className="text-ink-muted mt-2.5 line-clamp-2 text-sm leading-relaxed">
            <span className="mono-data text-pg-blue">[talk]</span> {session.title}
          </p>
        )}

        <div className="mt-3 flex items-center gap-3">
          {speaker.social.linkedin && (
            <a
              href={speaker.social.linkedin}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${speaker.name} on LinkedIn`}
              className="text-ink-muted hover:text-pg-blue relative z-10"
            >
              <LinkedInIcon className="size-4" />
            </a>
          )}
          {speaker.social.twitter && (
            <a
              href={speaker.social.twitter}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${speaker.name} on X`}
              className="text-ink-muted hover:text-pg-blue relative z-10"
            >
              <XIcon className="size-4" />
            </a>
          )}
          <span className="text-ink-muted group-hover:text-pg-blue ml-auto text-xs font-medium">
            View profile →
          </span>
        </div>
      </div>
    </article>
  );
}
