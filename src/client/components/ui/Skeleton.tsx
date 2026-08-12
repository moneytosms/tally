/** Loading placeholder. The screens used to render nothing while pending, which
 *  reads as an empty app rather than a loading one. Never used where a NUMBER
 *  would go without its label - a placeholder must not look like an amount. */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-[7px] ${className}`}
      style={{ background: "var(--paper-sunk)" }}
    />
  );
}

/** The generic "a screen is loading" placeholder: a title and a couple of cards.
 *  Screens used to render nothing while pending, which reads as an empty app
 *  rather than a loading one. */
export function ScreenSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  );
}
