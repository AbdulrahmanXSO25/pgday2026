import type { Speaker } from "@/lib/content";
import { SpeakerCard } from "@/components/speakers/speaker-card";

export function SpeakerGrid({ speakers, limit }: { speakers: Speaker[]; limit?: number }) {
  const visible = limit ? speakers.slice(0, limit) : speakers;

  return (
    <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
      {visible.map((speaker) => (
        <li key={speaker.id}>
          <SpeakerCard speaker={speaker} className="h-full" />
        </li>
      ))}
    </ul>
  );
}
