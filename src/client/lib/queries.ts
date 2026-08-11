// TanStack Query over the /api surface. Query keys live in `qk` so invalidation
// is never a guessed string.
//
// staleTime is 0 everywhere: every number here is money a user acts on, and a
// stale one is worse than a spinner. Nothing is persisted, and no service worker
// may ever cache an API response (SPEC §10).
import { useMutation, useQuery, useQueryClient, QueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { api } from "./api";
import { uuidv7 } from "~/shared/id";
import type { Paise, SplitMode } from "~/shared/money";
import type { CreateExpense, CreateLedger, CreateSettlement, UpdateProfile } from "~/shared/schemas";

/* ---------- wire types (server DTOs) ---------- */

export type Me = {
  id: string;
  displayName: string;
  vpa: string | null;
  isOwner: boolean;
  credentials: Array<{ id: string; createdAt: number; lastUsedAt: number | null }>;
};

export type LedgerSummary = {
  id: string;
  name: string;
  endDate: number | null;
  budget: Paise | null;
  archivedAt: number | null;
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

/* ---------- keys ---------- */

export const qk = {
  me: ["me"] as const,
  ledgers: ["ledgers"] as const,
  ledger: (ledgerId: string) => ["ledgers", ledgerId] as const,
  members: (ledgerId: string) => ["ledgers", ledgerId, "members"] as const,
  expenses: (ledgerId: string) => ["ledgers", ledgerId, "expenses"] as const,
  balances: (ledgerId: string) => ["ledgers", ledgerId, "balances"] as const,
  crossLedger: ["balances"] as const,
};

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

/* ---------- mutations ---------- */

export function useCreateLedger() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateLedger) =>
      api<LedgerSummary>("/api/ledgers", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.ledgers }),
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateProfile) => api<Me>("/api/me", { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: (me) => qc.setQueryData(qk.me, me),
  });
}

/** Optimistic on the expense LIST only. Balances are invalidated, never guessed —
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
    onSettled: () => {
      qc.invalidateQueries({ queryKey: qk.expenses(ledgerId) });
      qc.invalidateQueries({ queryKey: qk.balances(ledgerId) });
      qc.invalidateQueries({ queryKey: qk.ledgers });
      qc.invalidateQueries({ queryKey: qk.crossLedger });
    },
  });
}

export function useCreateSettlement(ledgerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSettlement) =>
      api<{ id: string }>(`/api/ledgers/${ledgerId}/settlements`, { method: "POST", body: JSON.stringify(body) }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: qk.balances(ledgerId) });
      qc.invalidateQueries({ queryKey: qk.ledgers });
      qc.invalidateQueries({ queryKey: qk.crossLedger });
    },
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
