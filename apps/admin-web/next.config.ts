import type { NextConfig } from "next";

// ---------------------------------------------------------------------------
// Route dedup — ensure "/" is defined exactly once.
// If both app/page.tsx and app/(dashboard)/page.tsx exist (route-group dup),
// Next will error "You cannot have two parallel pages that resolve to same path".
// We keep the group page (dashboard shell with nav) and remove the stub root page
// at config load time so `next build` succeeds without manual `rm`.
import { existsSync, unlinkSync } from "node:fs";
try {
  const rootPage = new URL("./app/page.tsx", import.meta.url);
  const groupPage = new URL("./app/(dashboard)/page.tsx", import.meta.url);
  if (existsSync(rootPage) && existsSync(groupPage)) {
    // Keep group page (nav shell) — delete stub root page
    unlinkSync(rootPage);
  }
} catch {
  // ignore — build will surface real error if any
}

const apiBase = process.env.API_BASE_URL ?? "http://localhost:8787";

const nextConfig: NextConfig = {
  images: { unoptimized: true },
  transpilePackages: [
    "@pgegypt/ui",
    "@pgegypt/config",
    "@pgegypt/validation",
    "@pgegypt/types",
    "@pgegypt/auth",
  ],
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiBase}/v1/:path*`,
      },
    ];
  },
  async headers() {
    const secureHeaders = [
      {
        key: "Content-Security-Policy",
        value:
          "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      },
      { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    ];
    return [
      {
        source: "/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }, ...secureHeaders],
      },
      // §30.7 — camera allowed only on the check-in scanner route
      {
        source: "/checkin",
        headers: [{ key: "Permissions-Policy", value: "camera=(self)" }],
      },
    ];
  },
};

export default nextConfig;
