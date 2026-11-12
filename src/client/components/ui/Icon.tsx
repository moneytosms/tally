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
  chevronRight: "M7.5 4.5 13 10l-5.5 5.5",
  down: "m6 8 4 4 4-4",
  close: "m5.5 5.5 9 9m0-9-9 9",
  plus: "M10 4v12M4 10h12",
  minus: "M4 10h12",
  more: "M4.5 10h.01M10 10h.01M15.5 10h.01",
  search: "M8.5 13.5a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM12.5 12.5l4 4",
  check: "m4.5 10.5 3.5 3.5 7.5-8",
  filter: "M3.5 5h13M6 10h8M8.5 15h3",
  star: "M10 3.2l2.05 4.2 4.6.65-3.33 3.25.79 4.6L10 13.6l-4.11 2.3.79-4.6L3.35 8.05l4.6-.65Z",
  starFilled: "M10 3.2l2.05 4.2 4.6.65-3.33 3.25.79 4.6L10 13.6l-4.11 2.3.79-4.6L3.35 8.05l4.6-.65Z",
  download: "M10 3.5v9m0 0-3.5-3.5m3.5 3.5 3.5-3.5M4 16.5h12",
  upload: "M10 12.5v-9m0 0L6.5 7m3.5-3.5L13.5 7M4 16.5h12",
  print: "M6 7V3.5h8V7M4.5 13.5h-1v-6h13v6h-1M6 11.5h8v5H6Z",
  edit: "M12.5 4.5l3 3L8 15H5v-3l7.5-7.5Z",
  trash: "M4 5.5h12M8 5.5V3.8h4v1.7M5.5 5.5l.7 10.7h7.6l.7-10.7",
  users:
    "M7.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM2.5 16c.6-2.4 2.6-3.7 5-3.7s4.4 1.3 5 3.7M13 4.6a2.4 2.4 0 0 1 0 4.6M14.6 12.6c1.4.6 2.2 1.8 2.5 3.4",
  repeat:
    "M4 9V7.5A2.5 2.5 0 0 1 6.5 5H15m0 0-2.5-2.5M15 5l-2.5 2.5M16 11v1.5a2.5 2.5 0 0 1-2.5 2.5H5m0 0 2.5 2.5M5 15l2.5-2.5",
  link: "M8.5 11.5l3-3M8 6.5 9.5 5a2.8 2.8 0 0 1 4 4L12 10.5M12 13.5 10.5 15a2.8 2.8 0 0 1-4-4L8 9.5",
  copy: "M7.5 7.5h8v8h-8ZM4.5 12.5v-9h8",
  archive: "M3.5 5.5h13v3h-13ZM4.5 8.5v6.5h11V8.5M8 11.5h4",
  settings: "M4 5h12M4 10h12M4 15h12M7 3.5v3M13 8.5v3M8 13.5v3",
  swap: "M4 7h11.5m0 0-2.5-2.5m2.5 2.5-2.5 2.5M16 13H4.5m0 0 2.5-2.5m-2.5 2.5 2.5 2.5",
  calendar: "M4 5.5h12v10.5H4ZM4 9h12M7 3.5v3M13 3.5v3",
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
      fill={name === "starFilled" ? "currentColor" : "none"}
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
