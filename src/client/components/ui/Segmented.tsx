import { focusRing } from "./focus";

/** Shared look for Segmented and Tabs, so the two cannot drift apart. */
export const segmentTrack = "flex rounded-[7px] border p-0.5";
export const segmentClass = (active: boolean, size: "md" | "sm" = "md") =>
  `flex min-h-11 min-w-0 flex-1 items-center justify-center rounded-[5px] px-1 text-center break-words no-underline transition-[background-color,color] duration-[180ms] ease-out hover:text-[var(--ink)] ${
    size === "sm" ? "text-[13px]" : "text-[14px]"
  } ${active ? "font-semibold" : ""} ${focusRing}`;
export const segmentStyle = (active: boolean) => ({
  background: active ? "var(--paper)" : "transparent",
  color: active ? "var(--ink)" : "var(--ink-2)",
});

/** One-of-N choice that is NOT a route (use Tabs for routes). `aria-pressed` buttons,
 *  2 to 4 options, every segment 44px tall. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  size = "md",
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  size?: "md" | "sm";
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={segmentTrack}
      style={{ background: "var(--paper-sunk)", borderColor: "var(--line)" }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={segmentClass(active, size)}
            style={segmentStyle(active)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
