import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

const baseStyles =
  "inline-flex items-center justify-center gap-2 rounded-sm border font-medium transition-colors duration-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pg-blue disabled:pointer-events-none disabled:opacity-50";

const variantStyles = {
  primary:
    "border-pg-blue-dark bg-pg-blue px-5 py-2 text-sm font-semibold text-white hover:bg-pg-blue-dark active:bg-pg-blue-dark",
  secondary:
    "border-hairline bg-surface px-5 py-2 text-sm font-semibold text-pg-blue hover:border-pg-blue hover:text-pg-blue-dark",
  ghost: "border-transparent bg-transparent px-2 py-1 text-sm text-ink-muted hover:text-pg-blue",
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
