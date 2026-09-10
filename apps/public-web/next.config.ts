import type { NextConfig } from "next";

/**
 * §30.7 — strict CSP for public-web.
 * connect-src must include the API origin because the registration + CFP forms
 * POST cross-origin directly to the API Worker (§7.4); no other third-party
 * origins are allowed.
 */
function resolveApiOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787";
  try {
    return new URL(raw).origin;
  } catch {
    return raw;
  }
}

const apiOrigin = resolveApiOrigin();

const secureHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      `connect-src 'self' ws: wss: ${apiOrigin}`,
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'self'",
    ].join("; "),
  },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
  },
  transpilePackages: ["@pgegypt/ui", "@pgegypt/config", "@pgegypt/validation", "@pgegypt/types"],
  async headers() {
    return [{ source: "/:path*", headers: secureHeaders }];
  },
};

export default nextConfig;
