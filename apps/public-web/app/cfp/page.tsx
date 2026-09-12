import type { Metadata } from "next";
import { CfpWizard } from "@/components/cfp/cfp-wizard";
import { siteConfig } from "@/lib/config";

export const metadata: Metadata = {
  title: "Call for Papers",
  description: `Propose a talk for ${siteConfig.event.name}. We're looking for PostgreSQL talks across every level.`,
};

export default function CfpPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-12 sm:px-8">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-pg-blue mb-2 text-sm font-semibold">Call for Papers</p>
        <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">
          Speak at PG Day Egypt
        </h1>
        <p className="text-ink-muted mt-4 leading-relaxed">
          We&apos;re looking for talks about PostgreSQL — from query tuning to replication,
          extensions, and the ecosystem around it. Submissions are reviewed by the program
          committee; accepted talks become part of the official schedule.
        </p>
      </div>

      <div className="mt-10">
        <CfpWizard />
      </div>
    </main>
  );
}
