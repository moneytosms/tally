import type { ButtonHTMLAttributes } from "react";
import { focusRing } from "./focus";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger";
  size?: "md" | "sm";
  /** Full width of its container. */
  block?: boolean;
  /** issue #44: a mutation's `isPending` - shows a spinner in place of the
   *  label instead of just going `disabled`, which reads as "broken", not "working". */
  isLoading?: boolean;
};

// Classes, not inline styles, so hover can reach the background. A caller's
// `style` still wins for one-off overrides.
const variants: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary:
    "border-[var(--moss)] bg-[var(--moss)] text-[var(--paper)] enabled:hover:border-[var(--moss-2)] enabled:hover:bg-[var(--moss-2)]",
  ghost: "border-[var(--line-2)] bg-transparent text-[var(--ink)] enabled:hover:bg-[var(--paper-sunk)]",
  danger: "border-[var(--clay)] bg-[var(--clay-wash)] text-[var(--clay)] enabled:hover:brightness-95",
};

function Spinner() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[15px] w-[15px] animate-spin">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Button({
  variant = "primary",
  size = "md",
  block = false,
  isLoading = false,
  disabled,
  className = "",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      {...props}
      // 44px minimum tap target - dense visuals do not mean dense touch targets.
      className={`inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-[7px] border ${
        size === "sm" ? "px-3 text-[14px] font-medium" : "px-4 text-[15px] font-semibold"
      } ${variants[variant]} ${block ? "w-full" : ""} transition-[background-color,border-color,transform,filter] duration-150 ease-out enabled:active:scale-[0.98] disabled:opacity-50 ${focusRing} ${className}`}
    >
      {isLoading && <Spinner />}
      {children}
    </button>
  );
}
