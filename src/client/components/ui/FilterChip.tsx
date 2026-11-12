import type { ReactNode } from "react";
import { focusRing } from "./focus";
import { Icon } from "./Icon";

/** One active filter, shown under the toolbar so it can always be seen and undone.
 *  Selected styling per DESIGN.md: moss-wash fill, moss border, deep-moss label. */
export function FilterChip({
  children,
  onRemove,
  removeLabel,
}: {
  children: ReactNode;
  onRemove?: () => void;
  removeLabel: string;
}) {
  return (
    <span
      className="inline-flex min-h-11 max-w-full items-center gap-1 rounded-[8px] border pl-3 text-[14px] font-semibold"
      style={{ background: "var(--moss-wash)", borderColor: "var(--moss)", color: "var(--moss-2)" }}
    >
      <span className="min-w-0 truncate">{children}</span>
      {onRemove && (
        <button
          type="button"
          aria-label={removeLabel}
          onClick={onRemove}
          className={`grid min-h-11 min-w-11 flex-none place-items-center rounded-[8px] hover:bg-[var(--paper-sunk)] ${focusRing}`}
        >
          <Icon name="close" size={16} />
        </button>
      )}
    </span>
  );
}
