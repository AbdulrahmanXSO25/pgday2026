import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-5 py-20">
      <div className="w-full max-w-xl text-center">
        <p className="text-pg-blue text-sm font-semibold">404</p>
        <h1 className="text-ink mt-3 text-4xl font-bold tracking-tight">Page not found</h1>
        <p className="text-ink-muted mt-3 text-lg leading-relaxed">
          The page you are looking for does not exist or has been moved.
        </p>

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
