import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { QueryProvider } from "@/lib/query";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Admin — PG Day Egypt 2026",
  description: "Admin panel for PG Day Egypt 2026",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="bg-page text-ink flex min-h-dvh flex-col font-sans antialiased">
        <QueryProvider>
          <header className="bg-surface border-pg-blue sticky top-0 z-50 border-b-2">
            <div className="mx-auto flex h-14 w-full max-w-[1600px] items-center px-4 sm:px-6 lg:px-8">
              <span className="text-ink text-sm font-bold tracking-tight">
                PG Day Egypt — Admin
              </span>
            </div>
          </header>
          <main className="flex flex-1 flex-col">{children}</main>
        </QueryProvider>
      </body>
    </html>
  );
}
