import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { siteConfig } from "@/lib/config";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://pgegypt-public-web.abdulrahmannader-123.workers.dev"),
  title: {
    default: `${siteConfig.event.name} — ${siteConfig.event.tagline}`,
    template: `%s · ${siteConfig.event.name}`,
  },
  description: `${siteConfig.event.name} — ${siteConfig.event.tagline}. A free, single-track community conference for PostgreSQL users in Egypt and the MENA region. ${siteConfig.event.dateDisplay}, ${siteConfig.event.city}.`,
  keywords: [
    "PostgreSQL",
    "Postgres",
    "conference",
    "Egypt",
    "Cairo",
    "MENA",
    "database",
    "community",
  ],
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://pgegypt-public-web.abdulrahmannader-123.workers.dev",
    siteName: siteConfig.event.name,
    title: `${siteConfig.event.name} — ${siteConfig.event.tagline}`,
    description: `A free, single-track PostgreSQL community conference. ${siteConfig.event.dateDisplay}, ${siteConfig.event.city}.`,
    images: [{ url: "/og.png", width: 1200, height: 630, alt: siteConfig.event.name }],
  },
  twitter: {
    card: "summary_large_image",
    title: `${siteConfig.event.name} — ${siteConfig.event.tagline}`,
    description: `A free, single-track PostgreSQL community conference. ${siteConfig.event.dateDisplay}, ${siteConfig.event.city}.`,
    images: ["/og.png"],
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="bg-page text-ink flex min-h-dvh flex-col font-sans antialiased">
        <a
          href="#main"
          className="bg-pg-blue sr-only z-[60] rounded-sm px-4 py-2 font-medium text-white focus:not-sr-only focus:absolute focus:top-4 focus:left-4"
        >
          Skip to content
        </a>
        <Header />
        <main id="main" className="flex-1">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
