import { NavLink } from "react-router";
import { t } from "~/client/i18n";
import { focusRing } from "./ui/focus";

// Glyphs, not an icon dependency. See prototypes/design-system.html.
const tabs = [
  { to: "/", glyph: "▤", key: "ledgers" },
  { to: "/balances", glyph: "⇄", key: "balances" },
  { to: "/insights", glyph: "◴", key: "insights" },
  { to: "/you", glyph: "◌", key: "you" },
];

export function TabBar() {
  return (
    <nav className="pad-safe-bottom flex shrink-0 border-t" style={{ background: "var(--paper-2)", borderColor: "var(--line)" }}>
      {tabs.map((tab) => (
        <NavLink
          key={tab.key}
          to={tab.to}
          end={tab.to === "/"}
          className={({ isActive }) =>
            `flex min-h-11 flex-1 flex-col items-center justify-center py-2.5 text-[10px] tracking-[0.04em] ${focusRing} ${
              isActive ? "is-active" : ""
            }`
          }
          style={({ isActive }) => ({ color: isActive ? "var(--moss-2)" : "var(--ink-3)" })}
        >
          {({ isActive }) => (
            <>
              <span aria-hidden="true" className="mb-0.5 text-[15px] font-normal">
                {tab.glyph}
              </span>
              <span className="uppercase">{t(`tabs.${tab.key}`)}</span>
              {isActive && <span className="sr-only">{t("nav.current")}</span>}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
