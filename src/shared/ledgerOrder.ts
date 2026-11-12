// Ledger list order and activity. ONE definition, shared by the server list
// route, the client's optimistic pin re-sort and the demo, so they cannot drift.
//
// Derived, never stored: lastActivityAt is computed from rows already loaded.

/** Entry times only. `paidAt` is user-entered (can be backdated), so it is never used. */
export function lastActivityAt(
  createdAt: number,
  expenses: ReadonlyArray<{ createdAt: number }>,
  settlements: ReadonlyArray<{ declaredAt: number }>,
): number {
  const times = [...expenses.map((e) => e.createdAt), ...settlements.map((s) => s.declaredAt)];
  return times.length ? Math.max(...times) : createdAt;
}

export type Orderable = {
  id: string;
  /** The VIEWER's star. */
  pinned: boolean;
  archivedAt: number | null;
  lastActivityAt: number;
  /** Tie-break only. Absent on the wire, so the client falls through to `id`. */
  createdAt?: number;
};

/** Archived last, then starred, then most recently active, then newest created, then id. */
export function compareLedgers(a: Orderable, b: Orderable): number {
  return (
    Number(a.archivedAt !== null) - Number(b.archivedAt !== null) ||
    Number(b.pinned) - Number(a.pinned) ||
    b.lastActivityAt - a.lastActivityAt ||
    (b.createdAt ?? 0) - (a.createdAt ?? 0) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}
