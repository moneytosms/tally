import type { ButtonHTMLAttributes, CSSProperties } from "react";
import { focusRing } from "./focus";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger";
  size?: "md" | "sm";
};

const styles: Record<NonNullable<ButtonProps["variant"]>, CSSProperties> = {
  primary: { background: "var(--moss)", color: "var(--paper)", borderColor: "var(--moss)" },
  ghost: { background: "transparent", color: "var(--ink)", borderColor: "var(--line-2)" },
  danger: { background: "var(--clay-wash)", color: "var(--clay)", borderColor: "var(--clay)" },
};

export function Button({ variant = "primary", size = "md", className = "", ...props }: ButtonProps) {
  return (
    <button
      type="button"
      {...props}
      // 44px minimum tap target - dense visuals do not mean dense touch targets.
      className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-[6px] border text-[14px] ${
        size === "sm" ? "px-3 font-normal" : "px-4 font-medium"
      } disabled:opacity-50 ${focusRing} ${className}`}
      style={{ ...styles[variant], ...props.style }}
    />
  );
}
