import Image from "next/image";
import { sponsorTierLabels, sponsorTierOrder, type Sponsor, type SponsorTier } from "@/lib/content";
import { cn } from "@/lib/utils";

const tierStyles: Record<SponsorTier, string> = {
  platinum: "h-16 sm:h-20 lg:h-24",
  gold: "h-12 sm:h-14 lg:h-16",
  silver: "h-10 sm:h-12 lg:h-14",
  community: "h-8 sm:h-9 lg:h-10",
};

const tierCols: Record<SponsorTier, string> = {
  platinum: "grid-cols-1 gap-4 sm:grid-cols-2",
  gold: "grid-cols-2 gap-4 sm:grid-cols-3",
  silver: "grid-cols-2 gap-4 sm:grid-cols-3",
  community: "grid-cols-3 gap-4 sm:grid-cols-4",
};

export function SponsorTier({ tier, sponsors }: { tier: SponsorTier; sponsors: Sponsor[] }) {
  if (sponsors.length === 0) return null;

  return (
    <div className="mb-10 last:mb-0">
      <h3 className="mono-data border-hairline text-ink-muted mb-4 border-b pb-2">
        <span className="text-pg-blue">--</span> {sponsorTierLabels[tier]}
      </h3>
      <ul className={cn("grid items-center", tierCols[tier])}>
        {sponsors.map((sponsor) => (
          <li key={sponsor.id} className="flex items-center justify-center">
            <a
              href={sponsor.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center justify-center p-3"
              aria-label={`${sponsor.name} (opens in a new tab)`}
            >
              <Image
                src={sponsor.logo}
                alt={`${sponsor.name} logo`}
                width={220}
                height={80}
                className={cn(
                  "w-auto opacity-80 transition-opacity duration-100 group-hover:opacity-100",
                  tierStyles[tier]
                )}
              />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SponsorGrid({ sponsors }: { sponsors: Sponsor[] }) {
  return (
    <div>
      {sponsorTierOrder.map((tier) => (
        <SponsorTier key={tier} tier={tier} sponsors={sponsors.filter((s) => s.tier === tier)} />
      ))}
    </div>
  );
}
