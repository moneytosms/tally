// Every per-ledger export lives here. The files are built by the server and
// downloaded as plain links; the printable report is a page in the app.
import { Link } from "react-router";
import { Card, Icon, Notice, type IconName } from "~/client/components/ui";
import { Sheet } from "~/client/components/ui/Sheet";
import { focusRing } from "~/client/components/ui/focus";
import { useOnline } from "~/client/lib/queries";
import { t } from "~/client/i18n";

const rowInner = (icon: IconName, title: string, body: string) => (
  <>
    <span className="mt-0.5 flex-none" style={{ color: "var(--ink-2)" }}>
      <Icon name={icon} />
    </span>
    <span className="min-w-0">
      <span className="block text-[15px] font-medium">{title}</span>
      <span className="block text-[13px]" style={{ color: "var(--ink-3)" }}>
        {body}
      </span>
    </span>
  </>
);

export function ExportSheet({ ledgerId, open, onClose }: { ledgerId: string; open: boolean; onClose: () => void }) {
  const online = useOnline();
  const link = `flex items-start gap-3 rounded-[7px] ${focusRing}`;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} title={t("ledger.menu.export")}>
      {!online ? (
        <Notice>{t("export.offline")}</Notice>
      ) : (
        <ul className="flex flex-col gap-2">
          <Card as="li" interactive>
            <a href={`/api/ledgers/${ledgerId}/export.csv`} download className={link}>
              {rowInner("download", t("export.expensesCsv"), t("export.expensesCsvBody"))}
            </a>
          </Card>
          <Card as="li" interactive>
            <a href={`/api/ledgers/${ledgerId}/settle.csv`} download className={link}>
              {rowInner("download", t("export.settleCsv"), t("export.settleCsvBody"))}
            </a>
          </Card>
          <Card as="li" interactive>
            <a href={`/api/ledgers/${ledgerId}/settle.xlsx`} download className={link}>
              {rowInner("download", t("export.settleXlsx"), t("export.settleXlsxBody"))}
            </a>
          </Card>
          <Card as="li" interactive>
            <Link to={`/ledgers/${ledgerId}/settle/report`} onClick={onClose} className={link}>
              {rowInner("print", t("export.reportPdf"), t("export.reportPdfBody"))}
            </Link>
          </Card>
        </ul>
      )}
    </Sheet>
  );
}
