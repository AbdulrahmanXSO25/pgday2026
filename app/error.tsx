"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="grid-texture relative flex min-h-[60vh] items-center justify-center px-5 py-20">
      <div className="max-w-xl text-center">
        <p className="mono-data text-neon-amber">ERROR: 500</p>
        <h1 className="font-display text-ink mt-3 text-3xl font-bold">Something went wrong</h1>
        <p className="text-ink-muted mt-3 leading-relaxed">
          The query blew up unexpectedly. Try running it again — if the problem persists, contact
          the organizing team.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button onClick={reset}>Retry</Button>
          <Button href="/" variant="secondary">
            Back to home
          </Button>
        </div>
      </div>
    </div>
  );
}
