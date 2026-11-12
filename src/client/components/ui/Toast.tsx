// Global error/success surface (issue #42). No toast/error-boundary primitive
// existed before this - mutation failures either flashed inline text or said
// nothing at all. This is the one place either kind of message now lands.
import { useSyncExternalStore } from "react";
import { t } from "~/client/i18n";
import { focusRing } from "./focus";
import { Icon } from "./Icon";

type ToastKind = "error" | "success";
type ToastEntry = { id: string; kind: ToastKind; message: string; leaving?: boolean };

let toasts: ToastEntry[] = [];
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

const DISMISS_MS = 5000;
// Matches --dur-fast in tokens.css: the toast stays mounted for its exit animation.
const EXIT_MS = 150;

function dismiss(id: string) {
  const current = toasts.find((t) => t.id === id);
  if (!current || current.leaving) return;
  toasts = toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t));
  notify();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    notify();
  }, EXIT_MS);
}

/** Pushed from anywhere - the mutation default handler in `lib/queries.ts`,
 *  or a component that wants to say something succeeded. Auto-dismisses so a
 *  string of failures doesn't wallpaper the screen. */
export function pushToast(message: string, kind: ToastKind = "error") {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  toasts = [...toasts, { id, kind, message }];
  notify();
  setTimeout(() => dismiss(id), DISMISS_MS);
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

const useToasts = () =>
  useSyncExternalStore(
    subscribe,
    () => toasts,
    () => [],
  );

/** Mounted once in App.tsx, above the tab bar. Errors are `role="alert"` (assertive);
 *  successes are `role="status"` (polite). The region itself stays mounted so the
 *  live-region announcements are not lost on first insert. */
export function ToastViewport() {
  const items = useToasts();
  return (
    <div className="no-print pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-3.5 bottom-[calc(var(--bar-h)_+_12px_+_var(--fab-clearance,0px)_+_env(safe-area-inset-bottom))] md:left-[232px] md:bottom-[calc(var(--bar-h)_+_12px_+_env(safe-area-inset-bottom))]">
      {items.map((toast) => (
        <div
          key={toast.id}
          role={toast.kind === "error" ? "alert" : "status"}
          className={`${toast.leaving ? "toast-exit pointer-events-none" : "toast-enter pointer-events-auto"} flex w-full max-w-sm items-center gap-2.5 rounded-[7px] border px-3.5 py-2.5 text-[13px] shadow-sm`}
          style={
            toast.kind === "error"
              ? { background: "var(--clay-wash)", borderColor: "var(--clay)", color: "var(--clay)" }
              : { background: "var(--moss-wash)", borderColor: "var(--moss)", color: "var(--moss-2)" }
          }
        >
          <span className="flex-1">{toast.message}</span>
          <button
            type="button"
            onClick={() => dismiss(toast.id)}
            aria-label={t("action.close")}
            className={`min-h-11 min-w-11 shrink-0 rounded-[5px] text-[var(--ink-3)] hover:text-[var(--ink)] ${focusRing}`}
          >
            <Icon name="close" size={16} className="mx-auto" />
          </button>
        </div>
      ))}
    </div>
  );
}
