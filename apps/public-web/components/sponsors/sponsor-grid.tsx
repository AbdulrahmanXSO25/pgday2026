import type { Sponsor } from "@/lib/content";
import { sponsorTierLabels, type SponsorTier as Tier } from "@/lib/content";

export function SponsorTier({ tier, sponsors }: { tier: Tier; sponsors: Sponsor[] }) {
  if (sponsors.length === 0) return null;
  return (
    <div>
      <h3 className="text-pg-blue mb-3 text-sm font-semibold">{sponsorTierLabels[tier]}</h3>
      <div className="grid gap-4 sm:grid-cols-3">
        {sponsors.map((s) => (
          <a
            key={s.id}
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            className="card card-hover flex items-center justify-center p-6 text-center"
          >
            <span className="text-ink font-semibold">{s.name}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
