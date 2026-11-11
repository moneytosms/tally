import { useEffect, useId, useRef } from "react";
import { Button } from "./Button";
import { t } from "~/client/i18n";

/** Modal confirm. Focus moves into the dialog and never lands on the destructive
 *  button by default. Escape cancels; focus returns to whatever opened it. */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel = t("action.cancel"),
  danger = true,
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  body?: string;
  /** A specific verb, e.g. "Delete expense". Never a generic "Confirm". */
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const bodyId = useId();
  const panel = useRef<HTMLDivElement>(null);
  // Latest callback without re-running the effect below, which would otherwise
  // re-capture focus on every parent render.
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onCancelRef.current = onCancel;
  });

  // Capture phase + stopPropagation: Escape cancels this dialog and nothing
  // underneath it, so a sheet behind the dialog stays open. Tab cycles inside
  // the dialog's buttons.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const el = panel.current;
    el?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancelRef.current();
        return;
      }
      if (e.key !== "Tab" || !el) return;
      const buttons = el.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      const active = document.activeElement;
      if (!first || !last) return;
      if (!el.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && (active === first || active === el)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      opener?.focus();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: "rgb(0 0 0 / 38%)" }}
    >
      <div
        ref={panel}
        role="alertdialog"
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby={titleId}
        aria-describedby={body ? bodyId : undefined}
        className="w-full max-w-sm rounded-[10px] border p-4"
        style={{ background: "var(--paper)", borderColor: "var(--line)" }}
      >
        <h2 id={titleId} className="serif text-[19px]">
          {title}
        </h2>
        {body && (
          <p id={bodyId} className="mt-2 text-[14px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
            {body}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? "danger" : "primary"} isLoading={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
