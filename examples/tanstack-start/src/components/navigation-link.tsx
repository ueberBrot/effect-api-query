import { createLink } from "@tanstack/react-router";
import { forwardRef } from "react";
import type { ComponentPropsWithoutRef, ForwardedRef } from "react";

interface NavigationAnchorProps extends ComponentPropsWithoutRef<"a"> {
  readonly variant?: "brand" | "default";
}

const variants = {
  brand:
    "display-heading flex items-center gap-2 px-0 text-lg font-black tracking-tight text-text-primary normal-case hover:border-transparent hover:bg-transparent hover:text-brand-300",
  default:
    "inline-block px-3 text-sm font-bold text-muted-foreground hover:border-brand-900 hover:bg-brand-950/30 hover:text-brand-200",
} as const;

const NavigationAnchorContent = (
  { className, children, variant = "default", ...props }: NavigationAnchorProps,
  ref: ForwardedRef<HTMLAnchorElement>
) => (
  <a
    className={[
      "border border-transparent py-2 no-underline transition-colors",
      variants[variant],
      className,
    ]
      .filter(Boolean)
      .join(" ")}
    ref={ref}
    {...props}
  >
    {children}
  </a>
);

const NavigationAnchor = forwardRef(NavigationAnchorContent);

NavigationAnchor.displayName = "NavigationAnchor";

export const NavigationLink = createLink(NavigationAnchor);
