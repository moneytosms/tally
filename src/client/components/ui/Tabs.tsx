import { NavLink } from "react-router";
import { segmentClass, segmentStyle, segmentTrack } from "./Segmented";

/** Segmented strip for switching between sibling screens. Looks exactly like
 *  <Segmented>; the active segment is NavLink's aria-current="page". */
export function Tabs({ items, label }: { items: Array<{ to: string; label: string; end?: boolean }>; label: string }) {
  return (
    <nav
      aria-label={label}
      className={segmentTrack}
      style={{ background: "var(--paper-sunk)", borderColor: "var(--line)" }}
    >
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) => segmentClass(isActive)}
          style={({ isActive }) => segmentStyle(isActive)}
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
