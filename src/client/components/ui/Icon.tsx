// The icon set. Authored SVG, no dependency: one 20px grid, 1.6 stroke, round
// caps, currentColor. Always decorative - the control around it carries the name.
const paths = {
  ledgers:
    "M5 3.5h10a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 15V5A1.5 1.5 0 0 1 5 3.5ZM7 7.5h6M7 10h6M7 12.5h3.5",
  balances: "M3.5 7h12m0 0-3-3m3 3-3 3M16.5 13h-12m0 0 3-3m-3 3 3 3",
  insights: "M10 3.5a6.5 6.5 0 1 0 6.5 6.5H10V3.5ZM12.5 2.5v5h5a5 5 0 0 0-5-5Z",
  you: "M10 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM4 16.5c.8-2.9 3.2-4.5 6-4.5s5.2 1.6 6 4.5",
  back: "M12.5 4.5 7 10l5.5 5.5",
  forward: "M7.5 4.5 13 10l-5.5 5.5",
  down: "m6 8 4 4 4-4",
  close: "m5.5 5.5 9 9m0-9-9 9",
  plus: "M10 4v12M4 10h12",
  more: "M4.5 10h.01M10 10h.01M15.5 10h.01",
  search: "M8.5 13.5a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM12.5 12.5l4 4",
  check: "m4.5 10.5 3.5 3.5 7.5-8",
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 20, className = "" }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      width={size}
      height={size}
      className={`shrink-0 ${className}`}
      fill="none"
      stroke="currentColor"
      // "more" is three dots drawn as zero-length round-capped strokes.
      strokeWidth={name === "more" ? 2.6 : 1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name]} />
    </svg>
  );
}
