// Four destinations: Ledgers, Balances, Insights, You. A bottom bar below md, a
// left rail at md and up - one <nav>, classes switch at the breakpoint.
// See docs/SPEC.md §10.
import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { t } from "~/client/i18n";
import { focusRing } from "./ui/focus";

// Authored SVG, not an icon dependency and not Unicode glyphs (which render at
// different widths per font). One 20px box, 1.6 stroke, currentColor.
// `active` maps a pathname to the tab it belongs to: a ledger screen is a Ledgers
// screen, and anything under /you (admin) is still the You tab.
const icons = {
  ledgers: (
    <path d="M5 3.5h10a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 15V5A1.5 1.5 0 0 1 5 3.5ZM7 7.5h6M7 10h6M7 12.5h3.5" />
  ),
  balances: <path d="M3.5 7h12m0 0-3-3m3 3-3 3M16.5 13h-12m0 0 3-3m-3 3 3 3" />,
  insights: <path d="M10 3.5a6.5 6.5 0 1 0 6.5 6.5H10V3.5ZM12.5 2.5v5h5a5 5 0 0 0-5-5Z" />,
  you: <path d="M10 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM4 16.5c.8-2.9 3.2-4.5 6-4.5s5.2 1.6 6 4.5" />,
};
const tabs = [
  { to: "/", key: "ledgers", active: (p: string) => p === "/" || p.startsWith("/ledgers/") },
  { to: "/balances", key: "balances", active: (p: string) => p === "/balances" },
  { to: "/insights", key: "insights", active: (p: string) => p === "/insights" },
  { to: "/you", key: "you", active: (p: string) => p === "/you" || p.startsWith("/you/") },
] as const;

/** `addButton` is shown only in the rail (md+); the Shell decides whether it exists. */
export function TabBar({ addButton }: { addButton?: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <nav
      aria-label={t("nav.main")}
      className="pad-safe-bottom order-last flex shrink-0 border-t select-none md:order-first md:w-[232px] md:flex-col md:border-t-0 md:border-r md:pt-5 md:pr-3 md:pb-4 md:pl-[calc(12px+env(safe-area-inset-left))]"
      style={{ background: "var(--paper-2)", borderColor: "var(--line)" }}
    >
      <div className="hidden md:mb-6 md:block">
        <div className="serif mb-4 px-2.5 text-[20px] leading-tight">{t("app.name")}</div>
        {addButton}
      </div>
      {tabs.map((tab) => {
        const isActive = tab.active(pathname);
        return (
          <Link
            key={tab.key}
            to={tab.to}
            aria-current={isActive ? "page" : undefined}
            className={`flex min-h-11 flex-1 flex-col items-center justify-center py-2.5 text-[12px] no-underline md:flex-none md:flex-row md:justify-start md:gap-3 md:rounded-[7px] md:px-2.5 md:py-0 md:text-[15px] ${focusRing} ${
              isActive ? "is-active md:font-semibold md:bg-[var(--moss-wash)]" : ""
            }`}
            style={{ color: isActive ? "var(--moss-2)" : "var(--ink-3)" }}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              className="mb-1 h-5 w-5 shrink-0 md:mb-0"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {icons[tab.key]}
            </svg>
            <span>{t(`tabs.${tab.key}`)}</span>
            {isActive && <span className="sr-only">{t("nav.current")}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
