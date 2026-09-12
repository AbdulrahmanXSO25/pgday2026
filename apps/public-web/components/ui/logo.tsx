import Link from "next/link";
import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn("group inline-flex items-center gap-2.5", className)}>
      <svg aria-hidden="true" viewBox="0 0 32 32" className="size-7 shrink-0" fill="none">
        <rect x="1" y="1" width="30" height="30" rx="2" className="fill-surface stroke-hairline" />
        <path
          d="M10.5 12.5c0-1.66 2.46-3 5.5-3s5.5 1.34 5.5 3-2.46 3-5.5 3-5.5-1.34-5.5-3Z"
          className="stroke-pg-blue"
          strokeWidth="1.8"
        />
        <path
          d="M10.5 12.5v7c0 1.66 2.46 3 5.5 3s5.5-1.34 5.5-3v-7"
          className="stroke-pg-blue"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <path
          d="M21 14.5v0M21 19.5v0"
          className="stroke-pg-blue"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
      </svg>
      <span className="flex flex-col leading-none">
        <span className="text-ink text-[15px] font-bold tracking-tight">PG Day Egypt</span>
        <span className="text-pg-blue mt-0.5 text-[10px] font-semibold">2026</span>
      </span>
    </Link>
  );
}
