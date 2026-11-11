// Four destinations: Ledgers, Balances, Insights, You. A bottom bar below md, a
// left rail at md and up - one <nav>, classes switch at the breakpoint.
// See docs/SPEC.md §10.
import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { t } from "~/client/i18n";
import { focusRing } from "./ui/focus";

// Glyphs, not an icon dependency. See prototypes/design-system.html.
// `active` maps a pathname to the tab it belongs to: a ledger screen is a Ledgers
// screen, and anything under /you (admin) is still the You tab.
const tabs = [
  { to: "/", glyph: "▤", key: "ledgers", active: (p: string) => p === "/" || p.startsWith("/ledgers/") },
  { to: "/balances", glyph: "⇄", key: "balances", active: (p: string) => p === "/balances" },
  { to: "/insights", glyph: "◴", key: "insights", active: (p: string) => p === "/insights" },
  { to: "/you", glyph: "◌", key: "you", active: (p: string) => p === "/you" || p.startsWith("/you/") },
];

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
            <span
              aria-hidden="true"
              className="mb-0.5 text-[20px] leading-none font-normal md:mb-0 md:w-5 md:text-[15px]"
            >
              {tab.glyph}
            </span>
            <span>{t(`tabs.${tab.key}`)}</span>
            {isActive && <span className="sr-only">{t("nav.current")}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
