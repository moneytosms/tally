import { NavLink } from "react-router";
import { focusRing } from "./focus";

/** Segmented strip for switching between sibling screens. Active segment is
 *  announced by NavLink's aria-current="page" and shown by weight and fill. */
export function Tabs({ items, label }: { items: Array<{ to: string; label: string; end?: boolean }>; label: string }) {
  return (
    <nav
      aria-label={label}
      className="flex rounded-[7px] border p-0.5"
      style={{ background: "var(--paper-sunk)", borderColor: "var(--line)" }}
    >
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            `flex min-h-11 min-w-0 flex-1 items-center justify-center rounded-[5px] px-1 text-center text-[14px] break-words no-underline ${
              isActive ? "font-semibold" : ""
            } ${focusRing}`
          }
          style={({ isActive }) => ({
            background: isActive ? "var(--paper)" : "transparent",
            color: isActive ? "var(--ink)" : "var(--ink-2)",
          })}
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
