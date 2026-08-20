import type { ButtonHTMLAttributes, CSSProperties } from "react";
import { focusRing } from "./focus";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger";
  size?: "md" | "sm";
  /** issue #44: a mutation's `isPending` - shows a spinner in place of the
   *  label instead of just going `disabled`, which reads as "broken", not "working". */
  isLoading?: boolean;
};

const styles: Record<NonNullable<ButtonProps["variant"]>, CSSProperties> = {
  primary: { background: "var(--moss)", color: "var(--paper)", borderColor: "var(--moss)" },
  ghost: { background: "transparent", color: "var(--ink)", borderColor: "var(--line-2)" },
  danger: { background: "var(--clay-wash)", color: "var(--clay)", borderColor: "var(--clay)" },
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
      className={`inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-[6px] border text-[14px] ${
        size === "sm" ? "px-3 font-normal" : "px-4 font-medium"
      } disabled:opacity-50 ${focusRing} ${className}`}
      style={{ ...styles[variant], ...props.style }}
    >
      {isLoading && <Spinner />}
      {children}
    </button>
  );
}
