import type { InputHTMLAttributes } from "react";
import { focusRing } from "./focus";
import { t } from "~/client/i18n";

/** Sunken field, per the design system. Native input - no masking, no cleverness. */
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

/** A rupee amount. The ₹ is part of the control, not a placeholder or a hint
 *  paragraph underneath it - this app has exactly one currency and the field
 *  should say so while you type. Still a plain text input: no masking, and the
 *  string goes to `rupeesToPaise` unchanged. */
export function Rupees({
  value,
  onChange,
  ...props
}: { value: string; onChange: (value: string) => void } & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type"
>) {
  return (
    <span className="relative block">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[14px]"
        style={{ color: "var(--ink-3)" }}
      >
        ₹
      </span>
      <Input
        {...props}
        inputMode="decimal"
        autoComplete="off"
        aria-describedby={undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={props.placeholder ?? t("money.placeholder")}
        className={`pl-7 ${props.className ?? ""}`}
      />
    </span>
  );
}
