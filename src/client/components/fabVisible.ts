// Where the floating + is useful: the Ledgers home, a ledger's Expenses tab and its
// Activity tab. Everywhere else adding an expense is not the task, so no + to cover content.
const LEDGER_LIST = /^\/ledgers\/[^/]+(\/activity)?\/?$/;

export function fabVisible(pathname: string, ctx: { hasActive: boolean; archivedHere: boolean }): boolean {
  // An expense needs a live ledger to land in: none active, or an archived one, means no +.
  if (!ctx.hasActive || ctx.archivedHere) return false;
  return pathname === "/" || LEDGER_LIST.test(pathname);
}
