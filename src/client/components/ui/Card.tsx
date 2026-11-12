import type { ReactNode } from "react";

/** The one panel and list-row surface. `interactive` adds the row press/hover feedback
 *  from tokens.css; the caller still decides whether the row is a link or a button. */
export function Card({
  children,
  as: Tag = "div",
  interactive = false,
  className = "",
}: {
  children: ReactNode;
  as?: "div" | "li" | "section" | "article";
  interactive?: boolean;
  className?: string;
}) {
  return (
    <Tag
      className={`rounded-[7px] border px-3.5 py-3 ${interactive ? "row-press" : ""} ${className}`}
      style={{ background: "var(--paper-2)", borderColor: "var(--line)" }}
    >
      {children}
    </Tag>
  );
}
