import { EmptyState } from "~/client/components/ui";
import { t } from "~/client/i18n";

// Deliberately no Recharts import. It is lazy-loaded when the charts actually
// land — bundle size fights "very fast" (SPEC §11.6).
export function InsightsTab() {
  return (
    <>
      <header className="mb-3">
        <h1 className="serif text-[21px] tracking-[-0.01em]">{t("tabs.insights")}</h1>
      </header>
      <EmptyState title={t("empty.insights")} body={t("empty.insightsBody")} />
    </>
  );
}
