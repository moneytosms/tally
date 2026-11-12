// Four tabs: Ledgers, Balances, Insights, You (bottom bar on phones, left rail on wide
// screens). One add-expense control: the floating + on phones, the rail button on wide
// screens. Both open the same sheet. See docs/SPEC.md §10.
import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useMatch, useNavigate } from "react-router";
import { TabBar } from "./components/TabBar";
import { Fab } from "./components/Fab";
import { fabVisible } from "./components/fabVisible";
import { focusRing, Mark, ScreenSkeleton } from "./components/ui";
import { Sheet } from "./components/ui/Sheet";
import { Button } from "./components/ui/Button";
import { ToastViewport } from "./components/ui/Toast";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useLedgers, useMe, useOnline } from "./lib/queries";
import { ApiError } from "./lib/api";
import { exitDemo, isDemo } from "./lib/demo";
import { t } from "./i18n";
import { LedgersTab } from "./routes/LedgersTab";
import { LedgerLayout } from "./routes/LedgerLayout";
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
const SettleReport = lazy(() => import("./routes/SettleReport"));

/** Explicit, and a live region - offline is never inferred from a missing number. */
function OfflineBanner() {
  if (useOnline()) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="no-print flex min-h-11 items-center px-4 py-2 text-[13px]"
      style={{ background: "var(--clay-wash)", color: "var(--clay)" }}
    >
      <strong className="font-medium">{t("offline.title")}</strong> {t("offline.body")}
    </div>
  );
}

/** Demo mode is always labelled, with the way out one tap away. */
function DemoBanner() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return (
    <div
      role="status"
      className="no-print flex min-h-11 items-center justify-between gap-3 px-4 text-[13px] leading-snug"
      style={{ background: "var(--paper-sunk)", color: "var(--ink-2)" }}
    >
      <span className="min-w-0">{t("demo.banner")}</span>
      {/* An underlined text link, not a button: the banner is a note. Still a 44px target. */}
      <button
        type="button"
        className={`min-h-11 shrink-0 whitespace-nowrap rounded-[5px] px-1 underline decoration-[var(--line-2)] underline-offset-4 ${focusRing}`}
        onClick={() => {
          exitDemo();
          qc.clear();
          navigate("/welcome", { replace: true });
        }}
      >
        {t("demo.exit")}
      </button>
    </div>
  );
}

/** Screens where the rail's "Add expense" is never shown: the profile area has nothing to add
 *  to, and the expense editor is a full screen of its own. (The FAB has its own rule, fabVisible.) */
const NO_FAB = /^\/you(\/|$)|^\/ledgers\/[^/]+\/expenses\//;

/** Every tab of one ledger shares a key, so switching tabs does not replay the
 *  page fade. The expense editor is a screen of its own. */
const LEDGER_PATH = /^\/ledgers\/[^/]+(?=\/|$)/;
const EXPENSE_PATH = /^\/ledgers\/[^/]+\/expenses\//;
const screenKey = (p: string) => (EXPENSE_PATH.test(p) ? p : (LEDGER_PATH.exec(p)?.[0] ?? p));

function Shell() {
  // The ledger is captured when the sheet opens, so a later Back cannot retarget it.
  const [addOpen, setAddOpen] = useState<{ ledgerId: string | undefined } | null>(null);
  const me = useMe();
  const ledgers = useLedgers();
  const { pathname } = useLocation();
  const [addPath, setAddPath] = useState(pathname);
  const routeLedgerId = useMatch("/ledgers/:ledgerId/*")?.params.ledgerId;
  const mainRef = useRef<HTMLElement>(null);

  // Navigating away closes the add sheet. Reset during render, not in an effect.
  if (addPath !== pathname) {
    setAddPath(pathname);
    setAddOpen(null);
  }

  // A new screen starts at its top, not wherever the last one was scrolled to.
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [pathname]);

  if (me.isPending)
    return (
      <div className="paper-ground flex h-full flex-col items-center justify-center gap-6 px-4">
        <Mark size={32} />
        <div className="w-full max-w-[560px]">
          <ScreenSkeleton />
        </div>
      </div>
    );
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

  const list = ledgers.data ?? [];
  const hasActive = list.some((l) => l.archivedAt === null);
  const archivedHere = Boolean(list.find((l) => l.id === routeLedgerId)?.archivedAt);
  const showFab = fabVisible(pathname, { hasActive, archivedHere });
  // The rail button is always there on md+ wherever adding an expense is allowed at all.
  const canAdd = hasActive && !archivedHere && !NO_FAB.test(pathname);
  const addButton = canAdd ? (
    <Button block onClick={() => setAddOpen({ ledgerId: routeLedgerId })}>
      {t("expense.add")}
    </Button>
  ) : null;

  return (
    <div
      className="paper-ground relative flex h-full flex-col overflow-hidden"
      // Toasts sit above the FAB when it is shown (read by ToastViewport's bottom offset).
      style={{ "--fab-clearance": showFab ? "57px" : "0px" } as CSSProperties}
    >
      <div className="pad-safe-top relative z-10 flex min-h-0 flex-1 flex-col md:flex-row">
        <TabBar addButton={addButton} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col md:pr-[env(safe-area-inset-right)]">
          {isDemo() && <DemoBanner />}
          <OfflineBanner />
          <UpdatePrompt />
          <InstallPrompt />
          <main
            ref={mainRef}
            className={`min-h-0 flex-1 overflow-auto overscroll-contain px-4 pt-3 md:pb-5 ${showFab ? "pb-[calc(65px+env(safe-area-inset-bottom))]" : "pb-22"}`}
          >
            <div className="mx-auto w-full max-w-[560px] md:max-w-[720px]">
              {/* Keyed on the screen so a page switch replays the fade rather
                  than snapping in - issue #45. The ErrorBoundary is keyed on the
                  full path so a crash on one tab does not stick to the next. */}
              <div key={screenKey(pathname)} className="page-in">
                <ErrorBoundary key={pathname}>
                  <Suspense fallback={<ScreenSkeleton />}>
                    <Outlet />
                  </Suspense>
                </ErrorBoundary>
              </div>
            </div>
          </main>
        </div>
        {showFab && <Fab onClick={() => setAddOpen({ ledgerId: routeLedgerId })} />}
        <ToastViewport />
      </div>
      <Sheet open={addOpen !== null} onOpenChange={(o) => !o && setAddOpen(null)} title={t("expense.newTitle")}>
        {addOpen && (
          <Suspense fallback={<ScreenSkeleton />}>
            <ExpenseForm ledgerId={addOpen.ledgerId} onDone={() => setAddOpen(null)} />
          </Suspense>
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
          <Route path="ledgers/:ledgerId" element={<LedgerLayout />}>
            <Route index element={<LedgerDetail />} />
            <Route path="settle" element={<SettleUp />} />
            <Route path="insights" element={<LedgerInsights />} />
            <Route path="activity" element={<ActivityTab />} />
            <Route path="recurring" element={<RecurringTab />} />
          </Route>
          {/* Editing is a full screen, not the add sheet: it needs an expense
              loaded from the server before anything can be shown. */}
          <Route path="ledgers/:ledgerId/expenses/:expenseId" element={<ExpenseEditor />} />
          {/* A print page inside Shell, not a tab: the tab bar is hidden in print only (no-print), not on this route. */}
          <Route path="ledgers/:ledgerId/settle/report" element={<SettleReport />} />
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
