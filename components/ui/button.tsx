import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

const baseStyles =
  "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-all duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neon-teal disabled:pointer-events-none disabled:opacity-50";

const variantStyles = {
  primary:
    "bg-neon-teal text-void px-6 py-3 text-sm font-semibold shadow-[0_0_18px_rgb(46_230_210/0.25)] hover:shadow-[0_0_24px_rgb(46_230_210/0.4)] hover:brightness-110 active:scale-[0.98]",
  secondary:
    "border border-hairline bg-transparent text-ink px-6 py-3 text-sm font-semibold hover:border-neon-teal/70 hover:text-neon-teal active:scale-[0.98]",
  ghost: "text-ink-muted hover:text-neon-teal px-2 py-1 text-sm",
} as const;

type Variant = keyof typeof variantStyles;

type CommonProps = {
  variant?: Variant;
  className?: string;
  children: ReactNode;
};

type ButtonAsButton = CommonProps & ButtonHTMLAttributes<HTMLButtonElement>;
type ButtonAsLink = CommonProps & AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };

type ButtonProps = ButtonAsButton | ButtonAsLink;

export function Button(props: ButtonProps) {
  const { variant = "primary", className, children, ...rest } = props;
  const classes = cn(baseStyles, variantStyles[variant], className);

  if ("href" in rest) {
    const { href, ...anchorProps } = rest as ButtonAsLink;
    return (
      <Link href={href} className={classes} {...anchorProps}>
        {children}
      </Link>
    );
  }

  const buttonProps = rest as ButtonAsButton;
  return (
    <button className={classes} {...buttonProps}>
      {children}
    </button>
  );
}
