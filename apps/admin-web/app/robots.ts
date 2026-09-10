import type { MetadataRoute } from "next";

/**
 * §27.3 — admin hostname must never be indexed.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      disallow: "/",
    },
  };
}
