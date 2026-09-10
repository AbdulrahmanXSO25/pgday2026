import type { Speaker } from "@/lib/content";
import { SpeakerCard } from "./speaker-card";

export function SpeakerGrid({ speakers }: { speakers: Speaker[] }) {
  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
      {speakers.map((s) => (
        <SpeakerCard key={s.id} speaker={s} />
      ))}
    </div>
  );
}
