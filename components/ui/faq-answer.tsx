import Link from "next/link";
import type { ReactNode } from "react";

const LINK_PATTERN = /\[([^\]]+)\]\((\/[^)]+)\)/;

export function renderFaqAnswer(answer: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let remaining = answer;
  let key = 0;

  while (remaining.length > 0) {
    const match = LINK_PATTERN.exec(remaining);
    if (!match) {
      parts.push(remaining);
      break;
    }
    if (match.index > 0) parts.push(remaining.slice(0, match.index));
    parts.push(
      <Link key={key++} href={match[2]} className="text-neon-teal font-medium hover:underline">
        {match[1]}
      </Link>
    );
    remaining = remaining.slice(match.index + match[0].length);
  }

  return parts;
}
