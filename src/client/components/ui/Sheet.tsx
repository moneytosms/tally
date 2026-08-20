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
    const opener = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onOpenChange(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      opener?.focus();
    };
  }, [open, onOpenChange]);

  if (!mounted) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
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
        className="paper-ground relative max-h-[90dvh] overflow-auto rounded-t-[14px] border-t"
        style={{
          background: "var(--paper)",
          borderColor: "var(--line)",
          animation: `${open ? "sheet-panel-in" : "sheet-panel-out"} ${CLOSE_MS}ms ease-out forwards`,
        }}
      >
        <div className="sticky top-0 flex items-center gap-3 border-b px-4 py-3" style={{ background: "var(--paper)", borderColor: "var(--line)" }}>
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
