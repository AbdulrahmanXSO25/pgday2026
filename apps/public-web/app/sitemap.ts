import type { MetadataRoute } from "next";
import { siteConfig } from "@/lib/config";
import { speakers } from "@/lib/content";

const BASE_URL = "https://2026day.pgegypt.org";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const staticPages: { path: string; priority: number }[] = [
    { path: "", priority: 1 },
    { path: "/about", priority: 0.8 },
    { path: "/schedule", priority: 0.9 },
    { path: "/speakers", priority: 0.8 },
    { path: "/cfp", priority: 0.9 },
    { path: "/venue", priority: 0.6 },
    { path: "/register", priority: 0.9 },
    { path: "/code-of-conduct", priority: 0.4 },
    { path: "/organizers", priority: 0.4 },
    { path: "/faq", priority: 0.5 },
    { path: "/contact", priority: 0.4 },
  ];

  if (siteConfig.features.showSponsors) {
    staticPages.push({ path: "/sponsors", priority: 0.5 });
  }

  return [
    ...staticPages.map(({ path, priority }) => ({
      url: `${BASE_URL}${path}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority,
    })),
    ...speakers.map((speaker) => ({
      url: `${BASE_URL}/speakers/${speaker.id}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
  ];
}
