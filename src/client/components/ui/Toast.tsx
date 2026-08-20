// Global error/success surface (issue #42). No toast/error-boundary primitive
// existed before this - mutation failures either flashed inline text or said
// nothing at all. This is the one place either kind of message now lands.
import { useSyncExternalStore } from "react";
import { t } from "~/client/i18n";

type ToastKind = "error" | "success";
type ToastEntry = { id: string; kind: ToastKind; message: string };

let toasts: ToastEntry[] = [];
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

const DISMISS_MS = 5000;

function dismiss(id: string) {
  toasts = toasts.filter((t) => t.id !== id);
  notify();
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

const useToasts = () => useSyncExternalStore(subscribe, () => toasts, () => []);

/** Mounted once in App.tsx, above the tab bar. `aria-live="assertive"` on the
 *  region (not per-toast) so screen readers announce each arrival without
 *  re-reading the whole stack. */
export function ToastViewport() {
  const items = useToasts();
  if (items.length === 0) return null;
  return (
    <div
      role="status"
      aria-live="assertive"
      className="pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-3.5"
      style={{ bottom: "calc(78px + env(safe-area-inset-bottom))" }}
    >
      {items.map((toast) => (
        <div
          key={toast.id}
          className="animate-[toast-in_.18s_ease-out] pointer-events-auto flex w-full max-w-sm items-center gap-2.5 rounded-[7px] border px-3.5 py-2.5 text-[13px] shadow-sm"
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
            className="min-h-8 min-w-8 shrink-0 rounded-[5px] text-[13px] opacity-70 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
