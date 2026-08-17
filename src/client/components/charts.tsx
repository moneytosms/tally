import { lazy } from "react";
import { t } from "~/client/i18n";

const reduceMotion =
  typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

// Earth tones from tokens.css, cycled per category/bar/member - colour is
// decoration here, never the only cue (a list next to each chart carries the
// real data).
export const CHART_COLORS = ["var(--moss)", "var(--ochre)", "var(--clay)", "var(--moss-2)"];

export type CategoryDatum = { categoryId: string | null; name: string; icon: string | null; spent: number; count: number };
export type MonthDatum = { month: string; spent: number };

// One `import("recharts")` module id shared by every lazy() call site in this
// module, so Rollup emits a single extra chunk regardless of how many charts
// pull from it - opening any insights page is what fetches it, nothing else does.
export const CategoryChart = lazy(() =>
  import("recharts").then((m) => ({
    default: ({ data }: { data: CategoryDatum[] }) => (
      <m.ResponsiveContainer width="100%" height={Math.max(120, data.length * 32)}>
        <m.BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }}>
          <m.XAxis type="number" hide />
          <m.YAxis type="category" dataKey="name" width={96} tick={{ fontSize: 11, fill: "var(--ink-3)" }} axisLine={false} tickLine={false} />
          <m.Bar dataKey="spent" isAnimationActive={!reduceMotion} radius={3}>
            {data.map((_, i) => (
              <m.Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </m.Bar>
        </m.BarChart>
      </m.ResponsiveContainer>
    ),
  })),
);

/** "2026-08" is a database value, not a label. */
const monthFormat = new Intl.DateTimeFormat("en-IN", { month: "short", year: "2-digit" });
export const monthLabel = (iso: string) => {
  const [y, m] = iso.split("-").map(Number);
  return y !== undefined && m !== undefined && Number.isFinite(y) && Number.isFinite(m)
    ? monthFormat.format(new Date(y, m - 1, 1))
    : iso;
};

export const MonthChart = lazy(() =>
  import("recharts").then((m) => ({
    default: ({ data }: { data: MonthDatum[] }) => (
      <m.ResponsiveContainer width="100%" height={180}>
        <m.BarChart data={data} margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
          <m.XAxis
            dataKey="month"
            tickFormatter={monthLabel}
            tick={{ fontSize: 10, fill: "var(--ink-3)" }}
            axisLine={false}
            tickLine={false}
          />
          <m.YAxis hide />
          <m.Bar dataKey="spent" fill="var(--moss)" isAnimationActive={!reduceMotion} radius={3} />
        </m.BarChart>
      </m.ResponsiveContainer>
    ),
  })),
);

export type PieDatum = { id: string; name: string; value: number };

/** A single labelled pie, used twice on the ledger insights page (paid /
 *  share) with two different datasets - the caller picks which numbers go in. */
export const MemberPieChart = lazy(() =>
  import("recharts").then((m) => ({
    default: ({ data }: { data: PieDatum[] }) => (
      <m.ResponsiveContainer width="100%" height={200}>
        <m.PieChart>
          <m.Pie data={data} dataKey="value" nameKey="name" innerRadius={40} outerRadius={80} isAnimationActive={!reduceMotion}>
            {data.map((_, i) => (
              <m.Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </m.Pie>
        </m.PieChart>
      </m.ResponsiveContainer>
    ),
  })),
);

export function ChartFallback({ height }: { height: number }) {
  return (
    <div className="grid place-items-center text-[12px]" style={{ height, color: "var(--ink-3)" }}>
      {t("insights.chartLoading")}
    </div>
  );
}

export function SectionHeading({ children }: { children: string }) {
  return (
    <div className="mx-0.5 mb-2 text-[10.5px] tracking-[0.13em] uppercase" style={{ color: "var(--ink-3)" }}>
      {children}
    </div>
  );
}
