import type { ReactNode } from "react";

/** Sunken-input wrapper. The label is always present — never a placeholder
 *  standing in for one. Wrapping <label> associates the control implicitly, so
 *  callers need no id plumbing; the error sits inside it and is announced with
 *  the field. */
export function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1.5 block text-[10.5px] tracking-[0.13em] uppercase" style={{ color: "var(--ink-3)" }}>
        {label}
      </span>
      {children}
      {error && (
        <span role="alert" className="mt-1.5 block text-[11.5px]" style={{ color: "var(--clay)" }}>
          {error}
        </span>
      )}
    </label>
  );
}
