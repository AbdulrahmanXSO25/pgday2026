import Link from "next/link";
import { TerminalWindow } from "@/components/ui/terminal-window";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="relative flex min-h-[60vh] items-center justify-center px-5 py-20">
      <div className="w-full max-w-xl">
        <TerminalWindow title="psql — 2026day.pgegypt.org" className="mx-auto">
          <pre className="text-ink font-mono text-sm leading-relaxed">
            <span className="text-pg-blue">pgegypt=# </span>
            <span className="text-ink">SELECT * FROM /{"{this-page}"};</span>
            {"\n"}
            <span className="text-pg-amber">ERROR: relation &quot;page&quot; does not exist</span>
            {"\n"}
            <span className="text-ink-muted">LINE 1: SELECT * FROM ...</span>
            {"\n"}
            <span className="text-ink-muted">{"                     ^"}</span>
            {"\n"}
            <span className="text-pg-blue">HINT: </span>
            <span className="text-ink">
              The page you&apos;re looking for was dropped in a previous migration.
            </span>
            {"\n"}
            <span className="text-pg-blue">pgegypt=# </span>
            <Link
              href="/"
              className="text-pg-blue decoration-pg-blue/50 hover:decoration-pg-blue underline underline-offset-4"
            >
              \c home
            </Link>
            <span className="animate-blink bg-pg-blue inline-block h-[1.05em] w-[0.6em] translate-y-[0.2em]" />
          </pre>
        </TerminalWindow>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button href="/">Back to home</Button>
          <Button href="/schedule" variant="secondary">
            View the schedule
          </Button>
        </div>
      </div>
    </div>
  );
}
