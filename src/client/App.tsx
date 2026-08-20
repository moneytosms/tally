// Four bottom tabs: Ledgers, Balances, Insights, You. Persistent FAB for add-expense.
// See docs/SPEC.md §10.
import { lazy, Suspense, useState } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from "react-router";
import { TabBar } from "./components/TabBar";
import { Fab } from "./components/Fab";
import { Sheet } from "./components/ui/Sheet";
import { ToastViewport } from "./components/ui/Toast";
import { focusRing } from "./components/ui/focus";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { LedgerForm, type LedgerKind } from "./components/LedgerForm";
import { useLedgers, useMe, useOnline } from "./lib/queries";
import { ApiError } from "./lib/api";
import { t } from "./i18n";
import { LedgersTab } from "./routes/LedgersTab";
import { LedgerDetail } from "./routes/LedgerDetail";
import { YouTab } from "./routes/YouTab";
import { Onboarding } from "./routes/Onboarding";
import { UpdatePrompt } from "./components/UpdatePrompt";
import { InstallPrompt } from "./components/InstallPrompt";

// Lazy so the shell doesn't wait on them. InsightsTab is lazy specifically
// because it pulls in Recharts, which is the largest thing in the bundle
// (SPEC §11 hazard 6) - do not make it a static import.
const BalancesTab = lazy(() => import("./routes/BalancesTab"));
const SettleUp = lazy(() => import("./routes/SettleUp"));
const ExpenseForm = lazy(() => import("./routes/ExpenseForm"));
const ExpenseEditor = lazy(() => import("./routes/ExpenseEditor"));
const InsightsTab = lazy(() => import("./routes/InsightsTab"));
const AdminPanel = lazy(() => import("./routes/AdminPanel"));
const RecurringTab = lazy(() => import("./routes/RecurringTab"));
const ActivityTab = lazy(() => import("./routes/ActivityTab"));
const LedgerInsights = lazy(() => import("./routes/LedgerInsights"));

/** Explicit, and a live region - offline is never inferred from a missing number. */
function OfflineBanner() {
  if (useOnline()) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="px-4 py-2 text-[12px]"
      style={{ background: "var(--clay-wash)", color: "var(--clay)" }}
    >
      <strong className="font-medium">{t("offline.title")}</strong> {t("offline.body")}
    </div>
  );
}

/** What the FAB offers. "expense" is the common case and stays first; the rest
 *  create a ledger, which used to have no entry point in the UI at all. */
type AddChoice = "expense" | LedgerKind;

function AddMenu({ onPick }: { onPick: (choice: AddChoice) => void }) {
  const ledgers = useLedgers();
  const me = useMe();
  const hasLedger = (ledgers.data ?? []).some((l) => l.archivedAt === null);
  // ADR 0008: a restricted account (joined via a ledger invite) can't create a
  // ledger - only expense entry is offered.
  const choices: AddChoice[] =
    me.data?.accountType === "restricted" ? ["expense"] : ["expense", "trip", "group", "pair"];

  return (
    <div className="flex flex-col gap-2">
      {choices.map((choice) => (
        <button
          key={choice}
          type="button"
          // An expense needs somewhere to live. With no ledger yet this is not a
          // dead end, it just explains itself and points at the options below.
          disabled={choice === "expense" && !hasLedger}
          onClick={() => onPick(choice)}
          className={`rounded-[7px] border px-3.5 py-3 text-left disabled:opacity-45 ${focusRing}`}
          style={{ background: "var(--paper-2)", borderColor: "var(--line)" }}
        >
          <span className="block text-[14.5px]">{t(`add.${choice}`)}</span>
          <span className="mt-0.5 block text-[11.5px]" style={{ color: "var(--ink-3)" }}>
            {t(choice === "expense" && !hasLedger ? "add.expenseNeedsLedger" : `add.${choice}Body`)}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Sub-pages that are about one specific thing (settling, history, a schedule).
 *  A floating "add expense" on top of them is an offer to leave, not an action.
 *
 *  A ledger's own screen is here too: three of the four things behind the "+"
 *  create a ledger, which is meaningless once you are inside one, and the fourth
 *  already has a named button next to the expenses it adds to. */
const FAB_HIDDEN = /\/(settle|activity|recurring)$|\/ledgers\/[^/]+\/insights$|^\/you|^\/ledgers\/[^/]+$/;

function Shell() {
  const [addOpen, setAddOpen] = useState(false);
  const [sheet, setSheet] = useState<AddChoice | null>(null);
  const me = useMe();
  const { pathname } = useLocation();

  if (me.isPending) return null;
  if (me.error instanceof ApiError && me.error.status === 401) return <Navigate to="/welcome" replace />;
  // No passkey AND no password means enrolment stopped half-way: register/options
  // creates the account and the session, and the passkey ceremony then failed.
  // Letting that land here shows an empty app and hides the real problem - and
  // the session outlives the tab, so they never see the passkey step again.
  // /welcome is the recoverable place: the session alone gets them fresh options.
  // A password account with no passkey is complete, not half-finished - it must
  // not be bounced, which is the whole reason hasPassword is in this condition.
  if (me.data && me.data.credentials.length === 0 && !me.data.hasPassword) {
    return <Navigate to="/welcome" replace />;
  }

  return (
    <div className="paper-ground relative flex h-full flex-col overflow-hidden">
      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        <OfflineBanner />
        <UpdatePrompt />
        <InstallPrompt />
        <main className="min-h-0 flex-1 overflow-auto px-3.5 pt-3 pb-5">
          {/* Keyed on the route so a tab/page switch replays the fade rather
              than snapping in - issue #45. */}
          <div key={pathname} className="page-in">
            <ErrorBoundary>
              <Suspense fallback={null}>
                <Outlet />
              </Suspense>
            </ErrorBoundary>
          </div>
        </main>
        {!FAB_HIDDEN.test(pathname) && <Fab onClick={() => setAddOpen(true)} />}
        <TabBar />
        <ToastViewport />
      </div>
      <Sheet open={addOpen} onOpenChange={setAddOpen} title={t("add.title")}>
        <AddMenu
          onPick={(choice) => {
            setAddOpen(false);
            setSheet(choice);
          }}
        />
      </Sheet>
      <Sheet open={sheet !== null} onOpenChange={(o) => !o && setSheet(null)} title={sheet ? t(`add.${sheet}`) : ""}>
        {sheet === "expense" ? (
          <Suspense fallback={null}>
            <ExpenseForm onDone={() => setSheet(null)} />
          </Suspense>
        ) : (
          sheet && <LedgerForm kind={sheet} onDone={() => setSheet(null)} />
        )}
      </Sheet>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/welcome" element={<Onboarding />} />
        <Route element={<Shell />}>
          <Route index element={<LedgersTab />} />
          <Route path="ledgers/:ledgerId" element={<LedgerDetail />} />
          {/* Editing is a full screen, not the add sheet: it needs an expense
              loaded from the server before anything can be shown. */}
          <Route path="ledgers/:ledgerId/expenses/:expenseId" element={<ExpenseEditor />} />
          <Route path="ledgers/:ledgerId/settle" element={<SettleUp />} />
          <Route path="ledgers/:ledgerId/recurring" element={<RecurringTab />} />
          <Route path="ledgers/:ledgerId/insights" element={<LedgerInsights />} />
          <Route path="ledgers/:ledgerId/activity" element={<ActivityTab />} />
          <Route path="balances" element={<BalancesTab />} />
          <Route path="insights" element={<InsightsTab />} />
          <Route path="you" element={<YouTab />} />
          <Route path="you/admin" element={<AdminPanel />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
