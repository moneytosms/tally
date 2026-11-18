// Expense list order. ONE definition, shared by the server and the client.
//
// `paidAt` is a calendar day (local midnight from the form, or the import's
// date), so every expense entered for the same day ties on it. `createdAt`
// breaks the tie, so the latest-entered expense of the day comes first.

export type TimeOrderable = { id: string; paidAt: number; createdAt: number };

/** Newest paid day first, then most recently entered, then id for stability. */
export function compareExpensesNewest(a: TimeOrderable, b: TimeOrderable): number {
  return b.paidAt - a.paidAt || b.createdAt - a.createdAt || a.id.localeCompare(b.id);
}
