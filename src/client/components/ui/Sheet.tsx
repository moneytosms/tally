import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { focusRing } from "./focus";
import { t } from "~/client/i18n";

// Matches the sheet-panel-out keyframe duration in tokens.css. The panel stays
// mounted this long after close so the slide-down actually plays instead of
// the sheet just vanishing (issue #45).
const CLOSE_MS = 180;

/** Bottom sheet / modal. Escape and backdrop close it; focus moves in and returns
 *  to whatever opened it. The slide transitions are killed by the global
 *  prefers-reduced-motion rule in tokens.css. */
export function Sheet({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  // Callers pass inline arrows. Read the latest one through a ref so a parent
  // re-render does not re-run the open effects and pull focus out of an input.
  const onOpenChangeRef = useRef(onOpenChange);
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  });
  // Stays true through the close animation - `open` itself flips the instant
  // the caller asks, which would otherwise unmount before the transition runs.
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) return setMounted(true);
    const timer = setTimeout(() => setMounted(false), CLOSE_MS);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onOpenChangeRef.current(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      opener.current?.focus();
    };
  }, [open]);

  // Runs once the panel is in the DOM. A child's autofocus has already run by
  // then, so this only moves focus when nothing inside the panel has it yet.
  useEffect(() => {
    if (!open || !mounted || !panel.current || panel.current.contains(document.activeElement)) return;
    panel.current.focus();
  }, [open, mounted]);

  if (!mounted) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end md:items-center md:justify-center">
      <div
        className="absolute inset-0"
        style={{
          background: "rgb(0 0 0 / 38%)",
          animation: `sheet-backdrop-in .18s ease-out ${open ? "" : "reverse"}`,
        }}
        onClick={() => onOpenChange(false)}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        // dvh, not vh: on mobile Chrome vh is the LARGEST viewport, so a 90vh
        // sheet can run under the URL bar and hide its own submit button.
        // md+: a centred dialog, not a bottom sheet (animation keyed in tokens.css).
        className={`paper-ground relative max-h-[90dvh] overflow-auto rounded-t-[14px] border-t md:max-h-[85dvh] md:w-full md:max-w-[520px] md:rounded-[14px] md:border ${
          open ? "sheet-in" : "sheet-out"
        }`}
        style={{ background: "var(--paper)", borderColor: "var(--line)" }}
      >
        <div
          className="sticky top-0 flex items-center gap-3 border-b px-4 py-3"
          style={{ background: "var(--paper)", borderColor: "var(--line)" }}
        >
          <h2 id={titleId} className="serif flex-1 text-[19px]">
            {title}
          </h2>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label={t("action.close")}
            className={`min-h-11 min-w-11 rounded-[6px] text-[18px] ${focusRing}`}
            style={{ color: "var(--ink-3)" }}
          >
            ✕
          </button>
        </div>
        <div className="pad-safe-bottom px-4 py-4">{children}</div>
      </div>
    </div>
  );
}
