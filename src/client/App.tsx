// Four bottom tabs: Ledgers, Balances, Insights, You. Persistent FAB for add-expense.
// See docs/SPEC.md §10.
import { lazy, Suspense, useState } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router";
import { TabBar } from "./components/TabBar";
import { Fab } from "./components/Fab";
import { Sheet } from "./components/ui/Sheet";
import { useMe, useOnline } from "./lib/queries";
import { ApiError } from "./lib/api";
import { t } from "./i18n";
import { LedgersTab } from "./routes/LedgersTab";
import { LedgerDetail } from "./routes/LedgerDetail";
import { YouTab } from "./routes/YouTab";
import { Onboarding } from "./routes/Onboarding";
import { UpdatePrompt } from "./components/UpdatePrompt";

// Lazy so the shell doesn't wait on them. InsightsTab is lazy specifically
// because it pulls in Recharts, which is the largest thing in the bundle
// (SPEC §11 hazard 6) — do not make it a static import.
const BalancesTab = lazy(() => import("./routes/BalancesTab"));
const SettleUp = lazy(() => import("./routes/SettleUp"));
const ExpenseForm = lazy(() => import("./routes/ExpenseForm"));
const InsightsTab = lazy(() => import("./routes/InsightsTab"));
const AdminPanel = lazy(() => import("./routes/AdminPanel"));
const RecurringTab = lazy(() => import("./routes/RecurringTab"));
const ActivityTab = lazy(() => import("./routes/ActivityTab"));

/** Explicit, and a live region — offline is never inferred from a missing number. */
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

function Shell() {
  const [addOpen, setAddOpen] = useState(false);
  const me = useMe();

  if (me.isPending) return null;
  if (me.error instanceof ApiError && me.error.status === 401) return <Navigate to="/welcome" replace />;

  return (
    <div className="paper-ground relative flex h-dvh flex-col overflow-hidden">
      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        <OfflineBanner />
        <UpdatePrompt />
        <main className="min-h-0 flex-1 overflow-auto px-3.5 pt-3 pb-5">
          <Suspense fallback={null}>
            <Outlet />
          </Suspense>
        </main>
        <Fab onClick={() => setAddOpen(true)} />
        <TabBar />
      </div>
      <Sheet open={addOpen} onOpenChange={setAddOpen} title={t("expense.add")}>
        <Suspense fallback={null}>
          <ExpenseForm onDone={() => setAddOpen(false)} />
        </Suspense>
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
          <Route path="ledgers/:ledgerId/settle" element={<SettleUp />} />
          <Route path="ledgers/:ledgerId/recurring" element={<RecurringTab />} />
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
