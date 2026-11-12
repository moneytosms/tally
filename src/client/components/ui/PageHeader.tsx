import type { ReactNode } from "react";
import { Link } from "react-router";
import { focusRing } from "./focus";
import { Icon } from "./Icon";
import { Mark } from "./Mark";
import { t } from "~/client/i18n";

/** Standard screen header. `back` is a route path; the back control is a real link. */
export function PageHeader({
  title,
  subtitle,
  back,
  action,
  railTitle = false,
  mark = false,
  leading,
}: {
  title: string;
  /** The title repeats the rail's brand at md+, so it is visually hidden there but stays the page's h1. */
  railTitle?: boolean;
  /** Show the product mark before the title (home only). */
  mark?: boolean;
  subtitle?: string;
  back?: string;
  action?: ReactNode;
  /** Content before the title block, e.g. a ledger's identity tile. */
  leading?: ReactNode;
}) {
  return (
    <header className="flex items-center gap-2 py-2">
      {back && (
        <Link
          to={back}
          aria-label={t("action.back")}
          className={`-ml-2 grid min-h-11 min-w-11 flex-none place-items-center rounded-[6px] transition-colors hover:bg-[var(--paper-sunk)] ${focusRing}`}
          style={{ color: "var(--ink-2)" }}
        >
          <Icon name="back" size={22} />
        </Link>
      )}
      {leading && <div className="flex flex-none items-center">{leading}</div>}
      <div className="min-w-0 flex-1">
        <div className={`flex items-center gap-2 ${railTitle ? "md:sr-only" : ""}`}>
          {mark && <Mark />}
          <h1 className={`serif truncate text-[22px] leading-tight`}>{title}</h1>
        </div>
        {subtitle && (
          <p className="line-clamp-2 text-[13px] leading-snug" style={{ color: "var(--ink-3)" }}>
            {subtitle}
          </p>
        )}
      </div>
      {action && <div className="flex flex-none items-center gap-2">{action}</div>}
    </header>
  );
}
