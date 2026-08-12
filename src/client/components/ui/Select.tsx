import type { SelectHTMLAttributes } from "react";
import { focusRing } from "./focus";

/** Sunken select matching <Input>. Native - the platform's own picker is better
 *  on a phone than anything worth building here. */
export function Select({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`min-h-11 w-full rounded-[6px] border px-3 text-[14px] ${focusRing} ${className}`}
      style={{ background: "var(--paper-sunk)", borderColor: "var(--line)", color: "var(--ink)", ...props.style }}
    />
  );
}
