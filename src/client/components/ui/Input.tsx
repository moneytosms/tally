import type { InputHTMLAttributes } from "react";
import { focusRing } from "./focus";

/** Sunken field, per the design system. Native input — no masking, no cleverness. */
export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`min-h-11 w-full rounded-[6px] border px-3 text-[14px] ${focusRing} ${className}`}
      style={{
        background: "var(--paper-sunk)",
        borderColor: "var(--line)",
        color: "var(--ink)",
        ...props.style,
      }}
    />
  );
}
