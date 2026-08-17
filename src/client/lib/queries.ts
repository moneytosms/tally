// TanStack Query over the /api surface. Query keys live in `qk` so invalidation
// is never a guessed string.
//
// staleTime is 0 everywhere: every number here is money a user acts on, and a
// stale one is worse than a spinner. Nothing is persisted, and no service worker
// may ever cache an API response (SPEC §10).
import { useMutation, useQuery, useQueryClient, QueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { api } from "./api";
import { markActed } from "~/client/components/InstallPrompt";
import { uuidv7 } from "~/shared/id";
import type { Paise, SplitMode } from "~/shared/money";
import type {
  CreateCategory,
  CreateExpense,
  CreateLedger,
  CreateSeries,
  CreateSettlement,
  UpdateLedger,
  UpdateProfile,
} from "~/shared/schemas";
import type { LEDGER_COLOR_VALUES } from "~/shared/schemas";

export type LedgerColor = (typeof LEDGER_COLOR_VALUES)[number];

/* ---------- wire types (server DTOs) ---------- */

export type Me = {
  id: string;
  displayName: string;
  vpa: string | null;
  isOwner: boolean;
  /** Sign-in address. Null on accounts that only ever enrolled a passkey. */
  email: string | null;
  hasPassword: boolean;
  credentials: Array<{ id: string; createdAt: number; lastUsedAt: number | null }>;
};

export type LedgerSummary = {
  id: string;
  name: string;
  endDate: number | null;
  budget: Paise | null;
  archivedAt: number | null;
  /** Whether this ledger may mint invite links at all (ADR 0007). Off by default. */
  invitesEnabled: boolean;
  /** Cover accent (issue #27). Fixed palette; null renders text-only, as ever. */
  color: LedgerColor | null;
  emoji: string | null;
  /** The VIEWER's own home-screen pin (issue #26) - one person's preference,
   *  not shared ledger state. */
  pinned: boolean;
  memberCount: number;
  /** viewer's net position in this ledger. positive = is owed */
  net: Paise;
  /** total spent, for the burn-rate line. only meaningful with a budget */
  spent: Paise;
};

export type Member = {
  id: string;
  userId: string | null;
  guestName: string | null;
  nickname: string;
  leftAt: number | null;
};

export type Expense = {
  id: string;
  ledgerId: string;
  description: string;
  total: Paise;
  paidAt: number;
  payerMemberId: string;
  categoryId: string | null;
  notes: string | null;
  mode: SplitMode;
  splits: Array<{ memberId: string; amount: Paise }>;
};

export type LedgerBalances = {
  positions: Array<{ memberId: string; net: Paise }>;
  transfers: Array<{ fromMemberId: string; toMemberId: string; amount: Paise }>;
};

export type CrossLedgerBalance = {
  userId: string;
  displayName: string;
  vpa: string | null;
  net: Paise;
};

export type Category = { id: string; name: string; icon: string; isDefault: boolean };

export type Comment = {
  id: string;
  body: string;
  authorUserId: string;
  authorName: string;
  createdAt: number;
};

export type Revision = {
  id: string;
  revisedBy: string;
  revisedByName: string;
  revisedAt: number;
  snapshot: Expense;
};

export type Insights = {
  totals: { spent: Paise; paid: Paise; expenseCount: number; ledgerCount: number };
  byCategory: Array<{ categoryId: string | null; name: string; icon: string | null; spent: Paise; count: number }>;
  byMonth: Array<{ month: string; spent: Paise }>;
  mostSpentWith: Array<{ userId: string; displayName: string; sharedExpenseCount: number; sharedTotal: Paise }>;
};

export type LedgerInsights = {
  totals: { spent: Paise; expenseCount: number };
  byCategory: Array<{ categoryId: string | null; name: string; icon: string | null; spent: Paise; count: number }>;
  byMonth: Array<{ month: string; spent: Paise }>;
  byMember: Array<{ memberId: string; nickname: string; paid: Paise; share: Paise }>;
};

export type Series = {
  id: string;
  ledgerId: string;
  description: string;
  total: Paise;
  payerMemberId: string;
  categoryId: string | null;
  notes: string | null;
  mode: SplitMode;
  participants: Array<{ memberId: string; value?: number }>;
  intervalUnit: "day" | "week" | "month";
  intervalCount: number;
  startAt: number;
  endAt: number | null;
  nextOccurrenceAt: number;
  pausedAt: number | null;
};

/** One derived feed event. `kind` maps to a locale key under `activity.*` -
 *  the phrasing is the client's job, so no English crosses the wire. */
export type ActivityEvent = {
  id: string;
  kind: "added" | "edited" | "deleted" | "settled" | "forgave" | "commented" | "joined" | "left";
  at: number;
  actorName: string | null;
  description: string | null;
  amount: Paise | null;
  fromName: string | null;
  toName: string | null;
  expenseId: string | null;
  /** Only on the cross-ledger home feed. */
  ledgerId?: string;
  ledgerName?: string;
};

export type AdminUser = {
  id: string;
  displayName: string;
  isOwner: boolean;
  createdAt: number;
  email: string | null;
  hasPassword: boolean;
  credentials: Array<{ id: string; createdAt: number; lastUsedAt: number | null }>;
};

/** Both ledger fields are null on an INSTANCE invite - one that admits someone
 *  to tally without putting them in any ledger. */
export type AdminInvite = {
  id: string;
  ledgerId: string | null;
  ledgerName: string | null;
  createdAt: number;
  expiresAt: number;
};

export type AdminInstance = {
  rpId: string;
  userCount: number;
  ledgerCount: number;
  pushConfigured: boolean;
  recurringConfigured: boolean;
};

/** Every field optional - an empty filter is the plain expense list. */
export type ExpenseFilters = {
  q?: string;
  categoryId?: string;
  memberId?: string;
  from?: number;
  to?: number;
};

/* ---------- keys ---------- */

export const qk = {
  me: ["me"] as const,
  ledgers: ["ledgers"] as const,
  ledger: (ledgerId: string) => ["ledgers", ledgerId] as const,
  members: (ledgerId: string) => ["ledgers", ledgerId, "members"] as const,
  expenses: (ledgerId: string) => ["ledgers", ledgerId, "expenses"] as const,
  balances: (ledgerId: string) => ["ledgers", ledgerId, "balances"] as const,
  crossLedger: ["balances"] as const,
  categories: ["categories"] as const,
  insights: (from: number | null, to: number | null) => ["insights", from, to] as const,
  ledgerInsights: (ledgerId: string) => ["ledgers", ledgerId, "insights"] as const,
  comments: (expenseId: string) => ["expenses", expenseId, "comments"] as const,
  revisions: (expenseId: string) => ["expenses", expenseId, "revisions"] as const,
  series: (ledgerId: string) => ["ledgers", ledgerId, "recurring"] as const,
  activity: (ledgerId: string) => ["ledgers", ledgerId, "activity"] as const,
  recentActivity: ["activity"] as const,
  pushKey: ["push", "key"] as const,
  adminUsers: ["admin", "users"] as const,
  adminInvites: ["admin", "invites"] as const,
  adminInstance: ["admin", "instance"] as const,
};

/** Nested under the ledger's expense key so any expense mutation invalidates a
 *  filtered view too - a filtered list is still the expense list. */
const expenseSearchKey = (ledgerId: string, f: ExpenseFilters) =>
  [...qk.expenses(ledgerId), "search", f] as const;

function filterQuery(f: ExpenseFilters): string {
  const p = new URLSearchParams();
  if (f.q?.trim()) p.set("q", f.q.trim());
  if (f.categoryId) p.set("categoryId", f.categoryId);
  if (f.memberId) p.set("memberId", f.memberId);
  if (f.from !== undefined) p.set("from", String(f.from));
  if (f.to !== undefined) p.set("to", String(f.to));
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 0, gcTime: 60_000, refetchOnWindowFocus: true, retry: 1 },
      mutations: { retry: 0 },
    },
  });
}

/* ---------- queries ---------- */

export const useMe = () => useQuery({ queryKey: qk.me, queryFn: () => api<Me>("/api/me"), retry: false });

export const useLedgers = () =>
  useQuery({ queryKey: qk.ledgers, queryFn: () => api<LedgerSummary[]>("/api/ledgers") });

export const useLedger = (ledgerId: string) =>
  useQuery({ queryKey: qk.ledger(ledgerId), queryFn: () => api<LedgerSummary>(`/api/ledgers/${ledgerId}`) });

export const useMembers = (ledgerId: string) =>
  useQuery({ queryKey: qk.members(ledgerId), queryFn: () => api<Member[]>(`/api/ledgers/${ledgerId}/members`) });

export const useExpenses = (ledgerId: string) =>
  useQuery({ queryKey: qk.expenses(ledgerId), queryFn: () => api<Expense[]>(`/api/ledgers/${ledgerId}/expenses`) });

export const useBalances = (ledgerId: string) =>
  useQuery({ queryKey: qk.balances(ledgerId), queryFn: () => api<LedgerBalances>(`/api/ledgers/${ledgerId}/balances`) });

export const useCrossLedgerBalances = () =>
  useQuery({ queryKey: qk.crossLedger, queryFn: () => api<CrossLedgerBalance[]>("/api/balances") });

/** The filtered expense list. With an empty filter this is `useExpenses`. */
export const useExpenseSearch = (ledgerId: string, filters: ExpenseFilters) =>
  useQuery({
    queryKey: expenseSearchKey(ledgerId, filters),
    queryFn: () => api<Expense[]>(`/api/ledgers/${ledgerId}/expenses${filterQuery(filters)}`),
  });

/** Categories change about once a year - the one place a longer staleTime is
 *  honest, because none of this is money. */
export const useCategories = () =>
  useQuery({ queryKey: qk.categories, queryFn: () => api<Category[]>("/api/categories"), staleTime: 5 * 60_000 });

export const useInsights = (from: number | null, to: number | null = null) =>
  useQuery({
    queryKey: qk.insights(from, to),
    queryFn: () => {
      const p = new URLSearchParams();
      if (from !== null) p.set("from", String(from));
      if (to !== null) p.set("to", String(to));
      const qs = p.toString();
      return api<Insights>(`/api/insights${qs ? `?${qs}` : ""}`);
    },
  });

export const useLedgerInsights = (ledgerId: string) =>
  useQuery({
    queryKey: qk.ledgerInsights(ledgerId),
    queryFn: () => api<LedgerInsights>(`/api/ledgers/${ledgerId}/insights`),
  });

export const useComments = (ledgerId: string, expenseId: string) =>
  useQuery({
    queryKey: qk.comments(expenseId),
    queryFn: () => api<Comment[]>(`/api/ledgers/${ledgerId}/expenses/${expenseId}/comments`),
  });

export const useRevisions = (ledgerId: string, expenseId: string) =>
  useQuery({
    queryKey: qk.revisions(expenseId),
    queryFn: () => api<Revision[]>(`/api/ledgers/${ledgerId}/expenses/${expenseId}/revisions`),
  });

export const useSeries = (ledgerId: string) =>
  useQuery({ queryKey: qk.series(ledgerId), queryFn: () => api<Series[]>(`/api/ledgers/${ledgerId}/recurring`) });

export const useActivity = (ledgerId: string) =>
  useQuery({
    queryKey: qk.activity(ledgerId),
    queryFn: () => api<ActivityEvent[]>(`/api/ledgers/${ledgerId}/activity`),
  });

/** The home feed: recent events across the ledgers you are in. */
export const useRecentActivity = () =>
  useQuery({ queryKey: qk.recentActivity, queryFn: () => api<ActivityEvent[]>("/api/activity") });

export const useAdminUsers = () =>
  useQuery({ queryKey: qk.adminUsers, queryFn: () => api<AdminUser[]>("/api/admin/users") });

export const useAdminInvites = () =>
  useQuery({ queryKey: qk.adminInvites, queryFn: () => api<AdminInvite[]>("/api/admin/invites") });

export const useAdminInstance = () =>
  useQuery({ queryKey: qk.adminInstance, queryFn: () => api<AdminInstance>("/api/admin/instance") });

/* ---------- mutations ---------- */

export function useCreateLedger() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateLedger) =>
      api<LedgerSummary>("/api/ledgers", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      markActed();
      qc.invalidateQueries({ queryKey: qk.ledgers });
      qc.invalidateQueries({ queryKey: qk.recentActivity });
    },
  });
}

/** Rename, end date, budget, invite switch. The response is the whole summary,
 *  so it seeds the detail cache rather than triggering a second round-trip. */
export function useUpdateLedger(ledgerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateLedger) =>
      api<LedgerSummary>(`/api/ledgers/${ledgerId}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: (ledger) => {
      qc.setQueryData(qk.ledger(ledgerId), ledger);
      qc.invalidateQueries({ queryKey: qk.ledgers });
    },
  });
}

/** Toggle the viewer's own home-screen pin (issue #26). Optimistic, since it is
 *  purely local preference and never worth a spinner - and rolled back on
 *  failure so the list can't drift from the server's idea of the order. */
export function useTogglePin(ledgerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pinned: boolean) =>
      api<LedgerSummary>(`/api/ledgers/${ledgerId}/pin`, { method: "POST", body: JSON.stringify({ pinned }) }),
    onMutate: async (pinned) => {
      await qc.cancelQueries({ queryKey: qk.ledgers });
      const prev = qc.getQueryData<LedgerSummary[]>(qk.ledgers);
      qc.setQueryData<LedgerSummary[]>(qk.ledgers, (rows) =>
        rows?.map((r) => (r.id === ledgerId ? { ...r, pinned } : r)),
      );
      return { prev };
    },
    onError: (_err, _pinned, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.ledgers, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: qk.ledgers });
      qc.invalidateQueries({ queryKey: qk.ledger(ledgerId) });
    },
  });
}

/** Archive and reopen are one hook because they are one route shape and one
 *  result. Archive is refused (409 `not_settled`) while any net position is
 *  non-zero - the caller shows that, it is never pre-judged here. */
export function useLedgerLifecycle(ledgerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (action: "archive" | "reopen") =>
      api<LedgerSummary>(`/api/ledgers/${ledgerId}/${action}`, { method: "POST" }),
    onSuccess: (ledger) => {
      qc.setQueryData(qk.ledger(ledgerId), ledger);
      qc.invalidateQueries({ queryKey: qk.ledgers });
      qc.invalidateQueries({ queryKey: qk.recentActivity });
    },
  });
}

/** Soft-delete, and only the creator may. Everything derived from the ledger
 *  list goes stale, including the cross-ledger balances it fed. */
export function useDeleteLedger(ledgerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ ok: true }>(`/api/ledgers/${ledgerId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.ledgers });
      qc.invalidateQueries({ queryKey: qk.crossLedger });
      qc.invalidateQueries({ queryKey: qk.recentActivity });
    },
  });
}

/** Blocked server-side while the leaver's net position is non-zero. */
export function useLeaveLedger(ledgerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ ok: true }>(`/api/ledgers/${ledgerId}/leave`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.members(ledgerId) });
      qc.invalidateQueries({ queryKey: qk.ledgers });
      qc.invalidateQueries({ queryKey: qk.crossLedger });
      qc.invalidateQueries({ queryKey: qk.recentActivity });
    },
  });
}

/** Owner-only. A guest is a member row with no user id - data, never a
 *  principal, so nothing here issues a session. */
export function useAddGuest(ledgerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (guestName: string) =>
      api<Member>(`/api/ledgers/${ledgerId}/guests`, { method: "POST", body: JSON.stringify({ guestName }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.members(ledgerId) });
      qc.invalidateQueries({ queryKey: qk.ledger(ledgerId) });
    },
  });
}

/** Owner-only. Blocked server-side (409 `non_zero_position`) while the member's
 *  net position is non-zero - same guard as self-leave, just aimed by the
 *  owner at someone who has gone inactive elsewhere. */
export function useRemoveMember(ledgerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (memberId: string) =>
      api<{ ok: true }>(`/api/ledgers/${ledgerId}/members/${memberId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.members(ledgerId) });
      qc.invalidateQueries({ queryKey: qk.ledger(ledgerId) });
      qc.invalidateQueries({ queryKey: qk.ledgers });
      qc.invalidateQueries({ queryKey: qk.crossLedger });
      qc.invalidateQueries({ queryKey: qk.recentActivity });
    },
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateProfile) => api<Me>("/api/me", { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: (me) => qc.setQueryData(qk.me, me),
  });
}

/** Ends the caller's own session. Clears the whole cache rather than just `me` -
 *  a stale ledger or balance from the outgoing session must not survive into
 *  whoever signs in next on this device. Shell's 401 handler does the redirect. */
export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ ok: true }>("/api/auth/logout", { method: "POST" }),
    onSuccess: () => qc.clear(),
  });
}

/** Self-service passkey revoke. The server refuses the caller's last credential
 *  (409, `last_credential`) - the same guard the admin route applies to others. */
export function useRevokeOwnCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (credentialId: string) => api<{ ok: true }>(`/api/me/devices/${credentialId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.me }),
  });
}

/** Optimistic on the expense LIST only. Balances are invalidated, never guessed -
 *  a derived number must not be predicted client-side. */
export function useCreateExpense(ledgerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateExpense) =>
      api<Expense>(`/api/ledgers/${ledgerId}/expenses`, { method: "POST", body: JSON.stringify(body) }),
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: qk.expenses(ledgerId) });
      const previous = qc.getQueryData<Expense[]>(qk.expenses(ledgerId));
      const pending: Expense = {
        id: uuidv7(),
        ledgerId,
        description: body.description,
        total: body.total,
        paidAt: body.paidAtEpochMs,
        payerMemberId: body.payerMemberId,
        categoryId: body.categoryId,
        notes: body.notes,
        mode: body.mode,
        splits: [],
      };
      qc.setQueryData<Expense[]>(qk.expenses(ledgerId), [pending, ...(previous ?? [])]);
      return { previous };
    },
    onError: (_e, _body, ctx) => {
      if (ctx?.previous) qc.setQueryData(qk.expenses(ledgerId), ctx.previous);
    },
    onSuccess: () => markActed(),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: qk.expenses(ledgerId) });
      qc.invalidateQueries({ queryKey: qk.balances(ledgerId) });
      qc.invalidateQueries({ queryKey: qk.ledgers });
      qc.invalidateQueries({ queryKey: qk.crossLedger });
      qc.invalidateQueries({ queryKey: qk.recentActivity });
    },
  });
}

export function useCreateSettlement(ledgerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSettlement) =>
      api<{ id: string }>(`/api/ledgers/${ledgerId}/settlements`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => markActed(),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: qk.balances(ledgerId) });
      qc.invalidateQueries({ queryKey: qk.ledgers });
      qc.invalidateQueries({ queryKey: qk.crossLedger });
      qc.invalidateQueries({ queryKey: qk.recentActivity });
    },
  });
}

/** Everything a write to one ledger can invalidate. Balances are DERIVED, so
 *  they are always refetched and never patched client-side. */
function invalidateLedger(qc: ReturnType<typeof useQueryClient>, ledgerId: string) {
  qc.invalidateQueries({ queryKey: qk.expenses(ledgerId) });
  qc.invalidateQueries({ queryKey: qk.balances(ledgerId) });
  qc.invalidateQueries({ queryKey: qk.ledgers });
  qc.invalidateQueries({ queryKey: qk.crossLedger });
  qc.invalidateQueries({ queryKey: qk.recentActivity });
}

export function useUpdateExpense(ledgerId: string, expenseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateExpense) =>
      api<Expense>(`/api/ledgers/${ledgerId}/expenses/${expenseId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSettled: () => {
      invalidateLedger(qc, ledgerId);
      qc.invalidateQueries({ queryKey: qk.revisions(expenseId) });
    },
  });
}

export function useDeleteExpense(ledgerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (expenseId: string) =>
      api<{ id: string }>(`/api/ledgers/${ledgerId}/expenses/${expenseId}`, { method: "DELETE" }),
    onSettled: (_d, _e, expenseId) => {
      invalidateLedger(qc, ledgerId);
      qc.invalidateQueries({ queryKey: qk.revisions(expenseId) });
    },
  });
}

export function useUndoExpense(ledgerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (expenseId: string) =>
      api<Expense>(`/api/ledgers/${ledgerId}/expenses/${expenseId}/undo`, { method: "POST" }),
    onSettled: (_d, _e, expenseId) => {
      invalidateLedger(qc, ledgerId);
      qc.invalidateQueries({ queryKey: qk.revisions(expenseId) });
    },
  });
}

/** Restores ONE named revision, not merely the latest. A restore rewrites money,
 *  so it invalidates exactly what undo does - balances are derived and must be
 *  refetched, never patched from the response. */
export function useRestoreRevision(ledgerId: string, expenseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (revisionId: string) =>
      api<Expense>(`/api/ledgers/${ledgerId}/expenses/${expenseId}/revisions/${revisionId}/restore`, {
        method: "POST",
      }),
    onSettled: () => {
      invalidateLedger(qc, ledgerId);
      qc.invalidateQueries({ queryKey: qk.revisions(expenseId) });
    },
  });
}

export function useAddComment(ledgerId: string, expenseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) =>
      api<Comment>(`/api/ledgers/${ledgerId}/expenses/${expenseId}/comments`, {
        method: "POST",
        body: JSON.stringify({ body }),
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.comments(expenseId) }),
  });
}

export function useDeleteComment(ledgerId: string, expenseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (commentId: string) =>
      api<{ id: string }>(`/api/ledgers/${ledgerId}/comments/${commentId}`, { method: "DELETE" }),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.comments(expenseId) }),
  });
}

export function useSaveSeries(ledgerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: CreateSeries & { id?: string }) =>
      api<Series>(`/api/ledgers/${ledgerId}/recurring${id ? `/${id}` : ""}`, {
        method: id ? "PATCH" : "POST",
        body: JSON.stringify(body),
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.series(ledgerId) }),
  });
}

export function useSeriesAction(ledgerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: "pause" | "delete" }) =>
      api<Series | { id: string }>(
        `/api/ledgers/${ledgerId}/recurring/${id}${action === "pause" ? "/pause" : ""}`,
        { method: action === "pause" ? "POST" : "DELETE" },
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.series(ledgerId) }),
  });
}

/** The token comes back exactly once and is never stored - the caller must show
 *  it immediately or it is gone. Not logged, not persisted, not re-fetchable. */
export function useCreateInvite(ledgerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<{ token: string; expiresAt: number }>(`/api/ledgers/${ledgerId}/invites`, { method: "POST" }),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.adminInvites }),
  });
}

/** Owner-only. Like an invite the token comes back once and is never stored -
 *  show it immediately or mint a new one. */
export function useCreateRecovery() {
  return useMutation({
    mutationFn: (userId: string) =>
      api<{ token: string; expiresAt: number }>(`/api/admin/users/${userId}/recovery`, { method: "POST" }),
  });
}

export function useRevokeCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, credentialId }: { userId: string; credentialId: string }) =>
      api<{ id: string }>(`/api/admin/users/${userId}/credentials/${credentialId}`, { method: "DELETE" }),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.adminUsers }),
  });
}

/** Owner-only emergency levers. Both end the user's live sessions, so the
 *  panel's own view of them goes stale either way. */
export function useSignOutUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api<{ id: string }>(`/api/admin/users/${userId}/sessions`, { method: "DELETE" }),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.adminUsers }),
  });
}

export function useClearPassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api<{ id: string }>(`/api/admin/users/${userId}/password`, { method: "DELETE" }),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.adminUsers }),
  });
}

export function useRevokeInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (inviteId: string) => api<{ id: string }>(`/api/admin/invites/${inviteId}`, { method: "DELETE" }),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.adminInvites }),
  });
}

export function useSaveCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCategory) =>
      api<Category>("/api/categories", { method: "POST", body: JSON.stringify(body) }),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.categories }),
  });
}

export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ id: string }>(`/api/categories/${id}`, { method: "DELETE" }),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.categories }),
  });
}

export function useNudge() {
  return useMutation({
    mutationFn: (body: { ledgerId: string; toUserId: string }) =>
      api<{ ok: true }>("/api/push/nudge", { method: "POST", body: JSON.stringify(body) }),
  });
}

/* ---------- connectivity ---------- */

const subscribeOnline = (cb: () => void) => {
  addEventListener("online", cb);
  addEventListener("offline", cb);
  return () => {
    removeEventListener("online", cb);
    removeEventListener("offline", cb);
  };
};

/** Offline shows an explicit state and NO NUMBERS AT ALL (SPEC §10).
 *  <Amount> reads this, so the rule holds everywhere money renders. */
export const useOnline = () =>
  useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
