import type { CSSProperties, ReactNode } from "react";

const tones: Record<"info" | "warn" | "danger", CSSProperties> = {
  info: { background: "var(--paper-sunk)", borderColor: "var(--line-2)", color: "var(--ink)" },
  warn: { background: "var(--paper-sunk)", borderColor: "var(--ochre)", color: "var(--ink)" },
  danger: { background: "var(--clay-wash)", borderColor: "var(--clay)", color: "var(--clay)" },
};

/** The one inline message box. `danger` is announced assertively. `action` is a
 *  text link or a small control, placed under the message. */
export function Notice({
  tone = "info",
  children,
  action,
}: {
  tone?: "info" | "warn" | "danger";
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : undefined}
      className="rounded-[7px] border px-3.5 py-3 text-[14px] leading-relaxed"
      style={tones[tone]}
    >
      <div>{children}</div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
