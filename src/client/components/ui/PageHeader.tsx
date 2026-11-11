import type { ReactNode } from "react";
import { Link } from "react-router";
import { focusRing } from "./focus";
import { t } from "~/client/i18n";

/** Standard screen header. `back` is a route path; the back control is a real link. */
export function PageHeader({
  title,
  subtitle,
  back,
  action,
}: {
  title: string;
  subtitle?: string;
  back?: string;
  action?: ReactNode;
}) {
  return (
    <header className="flex items-center gap-2 py-2">
      {back && (
        <Link
          to={back}
          aria-label={t("action.back")}
          className={`grid min-h-11 min-w-11 flex-none place-items-center rounded-[6px] text-[20px] ${focusRing}`}
          style={{ color: "var(--ink-2)" }}
        >
          <span aria-hidden="true">←</span>
        </Link>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="serif truncate text-[22px] leading-tight">{title}</h1>
        {subtitle && (
          <p className="truncate text-[13px]" style={{ color: "var(--ink-3)" }}>
            {subtitle}
          </p>
        )}
      </div>
      {action && <div className="flex flex-none items-center gap-2">{action}</div>}
    </header>
  );
}
