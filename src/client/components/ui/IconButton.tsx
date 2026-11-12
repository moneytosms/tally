import type { ButtonHTMLAttributes } from "react";
import { t } from "~/client/i18n";
import { focusRing } from "./focus";
import { Icon, type IconName } from "./Icon";

/** Square 44px icon-only button. `label` is required and becomes aria-label; a
 *  `badge` (count, or true for a dot) is announced as part of it. `size` sets the
 *  glyph size only; the target stays 44px. */
export function IconButton({
  icon,
  label,
  pressed,
  badge,
  size = "md",
  className = "",
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  icon: IconName;
  label: string;
  pressed?: boolean;
  badge?: number | true;
  size?: "md" | "sm";
}) {
  const count = typeof badge === "number" ? badge : 0;
  const showBadge = badge === true || count > 0;
  const badgeText = typeof badge === "number" ? t("badge.count", { count }) : badge === true ? t("badge.dot") : "";
  return (
    <button
      type="button"
      {...props}
      aria-label={showBadge ? `${label}, ${badgeText}` : label}
      aria-pressed={pressed}
      className={`relative grid min-h-11 min-w-11 flex-none place-items-center rounded-[7px] transition-[background-color,color] duration-150 ease-out hover:bg-[var(--paper-sunk)] disabled:opacity-50 ${focusRing} ${className}`}
      style={{
        color: pressed ? "var(--moss-2)" : "var(--ink-2)",
        background: pressed ? "var(--moss-wash)" : undefined,
        ...props.style,
      }}
    >
      <Icon name={icon} size={size === "sm" ? 16 : 20} />
      {badge === true && (
        <span
          aria-hidden="true"
          className="absolute top-2.5 right-2.5 h-2 w-2 rounded-full"
          style={{ background: "var(--moss)" }}
        />
      )}
      {count > 0 && (
        <span
          aria-hidden="true"
          className="tnum absolute top-1 right-1 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[11px] leading-none font-semibold"
          style={{ background: "var(--moss)", color: "var(--paper)" }}
        >
          {count}
        </span>
      )}
    </button>
  );
}
