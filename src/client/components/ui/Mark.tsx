// tally's mark: a tally of five, four strokes and the strike through them. Drawn
// in moss with a slight hand-set irregularity so it reads as marked, not typeset.
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className="shrink-0"
      fill="none"
      stroke="var(--moss)"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M6 5.5v13M10 5v13.5M14 5.5v13M18 5v13.5" />
      <path d="M3.5 15.5 20.5 8" />
    </svg>
  );
}
