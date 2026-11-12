// The one date format. Never toLocaleDateString: every screen goes through these.
import { t } from "~/client/i18n";

const DATE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });
const DATE_TIME = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const DAY_MS = 86_400_000;

export const formatDate = (value: number | Date) => DATE.format(value);
export const formatDateTime = (value: number | Date) => DATE_TIME.format(value);

/** "Today", "Yesterday", "3 days ago"; a plain date after 30 days (or for a future date).
 *  `now` is injectable so tests do not depend on the clock. Days are calendar days. */
export function formatRelative(ms: number, now: number = Date.now()): string {
  const startOf = (time: number) => {
    const d = new Date(time);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const days = Math.round((startOf(now) - startOf(ms)) / DAY_MS);
  if (days < 0 || days > 30) return formatDate(ms);
  if (days === 0) return t("time.today");
  if (days === 1) return t("time.yesterday");
  return t("time.daysAgo", { count: days });
}
