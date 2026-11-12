import type { ReactNode } from "react";

/** The one section title. `action` sits on the same row, right-aligned. */
export function SectionHeading({
  children,
  action,
  as: Tag = "h2",
}: {
  children: ReactNode;
  action?: ReactNode;
  as?: "h2" | "h3";
}) {
  return (
    <div className="mx-0.5 mt-5 mb-2 flex items-center justify-between gap-2 first:mt-1">
      <Tag className="text-[13px] font-semibold" style={{ color: "var(--ink-2)" }}>
        {children}
      </Tag>
      {action}
    </div>
  );
}
