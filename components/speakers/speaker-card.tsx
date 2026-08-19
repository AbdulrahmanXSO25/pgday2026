import Link from "next/link";
import Image from "next/image";
import { getSession, type Speaker } from "@/lib/content";
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
  const session = getSession(speaker.talkId);

  return (
    <article
      className={cn(
        "card card-hover group focus-within:ring-neon-teal focus-within:ring-offset-void relative flex flex-col overflow-hidden focus-within:ring-2 focus-within:ring-offset-2",
        className
      )}
    >
      <Link
        href={`/speakers/${speaker.id}`}
        tabIndex={-1}
        aria-hidden="true"
        className="bg-surface-raised relative block aspect-square overflow-hidden focus-visible:outline-none"
      >
        <Image
          src={speaker.photo}
          alt={`Portrait of ${speaker.name}`}
          fill
          priority={priority}
          sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
          className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        />
        <div
          aria-hidden="true"
          className="from-surface absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t to-transparent"
        />
      </Link>

      <div className="flex flex-1 flex-col p-5">
        <h3 className="font-display text-ink text-lg font-semibold">
          <Link
            href={`/speakers/${speaker.id}`}
            className="group-hover:text-neon-teal transition-colors focus-visible:outline-none"
          >
            <span aria-hidden="true" className="absolute inset-0" />
            {speaker.name}
          </Link>
        </h3>
        <p className="mono-data text-ink-muted mt-1">
          {speaker.role} · {speaker.company}
        </p>

        {session && (
          <p className="text-ink-muted mt-3 line-clamp-2 text-sm leading-relaxed">
            <span className="mono-data text-neon-teal/70">[talk]</span> {session.title}
          </p>
        )}

        <div className="mt-4 flex items-center gap-3">
          {speaker.social.linkedin && (
            <a
              href={speaker.social.linkedin}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${speaker.name} on LinkedIn`}
              className="text-ink-muted hover:text-neon-teal relative z-10 transition-colors"
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
              className="text-ink-muted hover:text-neon-teal relative z-10 transition-colors"
            >
              <XIcon className="size-4" />
            </a>
          )}
          <span className="text-ink-muted group-hover:text-neon-teal ml-auto text-xs font-medium transition-colors">
            View profile →
          </span>
        </div>
      </div>
    </article>
  );
}
