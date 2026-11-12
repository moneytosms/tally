import type { ReactNode } from "react";

const tones = {
  neutral: { background: "var(--paper-sunk)", color: "var(--ink-2)", borderColor: "var(--line)" },
  moss: { background: "var(--moss-wash)", color: "var(--moss-2)", borderColor: "var(--moss-wash)" },
  clay: { background: "var(--clay-wash)", color: "var(--clay)", borderColor: "var(--clay-wash)" },
};

/** The one pill. Text only: say the state in words, colour only backs it up. */
export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "moss" | "clay" }) {
  return (
    <span
      className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-[13px] leading-snug whitespace-nowrap"
      style={tones[tone]}
    >
      {children}
    </span>
  );
}
