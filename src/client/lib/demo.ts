// Demo mode: an in-memory stand-in for /api, so a visitor can try the app with
// no account. Nothing persists and nothing leaves the tab - a refresh reseeds.
// Balances are still DERIVED, by the real server/balances code over this data;
// splits are resolved by the real resolveSplits. Never a hardcoded number.
import type { ZodType } from "zod";
import { grossPairs, netPositions, trailFor, transferPlan } from "~/server/balances";
import { t } from "~/client/i18n";
import { uuidv7 } from "~/shared/id";
import { resolveSplits, type Paise } from "~/shared/money";
import {
  addGuestSchema,
  createCategorySchema,
  createCommentSchema,
  createExpenseSchema,
  createLedgerSchema,
  createSettlementSchema,
  pinLedgerSchema,
  updateLedgerSchema,
  updateProfileSchema,
  type CreateExpense,
} from "~/shared/schemas";
import { ApiError } from "./api";
import type { ActivityEvent, Category, Comment, Expense, LedgerSummary, Me, Member, Series } from "./queries";

const FLAG = "tally.demo";
const ME = "demo-me";
const DAY = 86_400_000;

let active = false;
try {
  active = sessionStorage.getItem(FLAG) === "1";
} catch {
  /* storage blocked: demo then lasts until reload, which is fine */
}

export const isDemo = () => active;

export function enterDemo() {
  active = true;
  S = seed();
  try {
    sessionStorage.setItem(FLAG, "1");
  } catch {
    /* see above */
  }
}

export function exitDemo() {
  active = false;
  try {
    sessionStorage.removeItem(FLAG);
  } catch {
    /* see above */
  }
}

/* ---------- store ---------- */

type DLedger = Omit<LedgerSummary, "memberCount" | "net" | "spent">;
type DMember = Member & { ledgerId: string };
type DExpense = Omit<Expense, "splits"> & {
  splits: Array<{ memberId: string; amount: Paise; inputValue: number | null }>;
};
type DSettlement = {
  id: string;
  ledgerId: string;
  fromMemberId: string;
  toMemberId: string;
  amount: Paise;
  method: "upi" | "manual" | "forgiven";
  note: string | null;
  declaredAt: number;
};
type DComment = Comment & { expenseId: string };
type State = {
  me: { displayName: string; vpa: string | null };
  people: Map<string, { displayName: string; vpa: string | null }>;
  ledgers: DLedger[];
  members: DMember[];
  expenses: DExpense[];
  settlements: DSettlement[];
  comments: DComment[];
  categories: Category[];
};

function resolve(S: State, ledgerId: string, body: CreateExpense) {
  const ids = new Set(S.members.filter((m) => m.ledgerId === ledgerId).map((m) => m.id));
  const ps = body.participants;
  if (!ids.has(body.payerMemberId) || ps.some((p) => !ids.has(p.memberId)))
    throw new ApiError(422, "unknown member", "invalid");
  let parts: Paise[];
  try {
    parts = resolveSplits({
      total: body.total,
      mode: body.mode,
      participantCount: ps.length,
      payerIndex: ps.findIndex((p) => p.memberId === body.payerMemberId),
      values: body.mode === "equal" ? undefined : ps.map((p) => p.value ?? Number.NaN),
    });
  } catch (e) {
    throw new ApiError(422, (e as Error).message, "invalid");
  }
  return ps.map((p, i) => ({ memberId: p.memberId, amount: parts[i]!, inputValue: p.value ?? null }));
}

function seed(): State {
  const now = Date.now();
  const S: State = {
    me: { displayName: "Sam", vpa: "sam@okbank" },
    people: new Map([
      [ME, { displayName: "Sam", vpa: "sam@okbank" }],
      ["demo-asha", { displayName: "Asha", vpa: "asha@okbank" }],
      ["demo-ravi", { displayName: "Ravi", vpa: "ravi@okbank" }],
      ["demo-meera", { displayName: "Meera", vpa: null }],
    ]),
    ledgers: [],
    members: [],
    expenses: [],
    settlements: [],
    comments: [],
    categories: [
      ["c-food", "Food", "🍽️"],
      ["c-transport", "Transport", "🚕"],
      ["c-stay", "Stay", "🏨"],
      ["c-groceries", "Groceries", "🛒"],
      ["c-bills", "Bills", "💡"],
      ["c-fun", "Fun", "🎬"],
    ].map(([id, name, icon]) => ({ id: id!, name: name!, icon: icon!, isDefault: true })),
  };

  const ledger = (id: string, name: string, emoji: string, color: LedgerSummary["color"], people: string[]) => {
    S.ledgers.push({
      id,
      name,
      endDate: null,
      budget: null,
      archivedAt: null,
      invitesEnabled: false,
      color,
      emoji,
      pinned: false,
    });
    for (const p of people) {
      const u = S.people.get(p);
      S.members.push({
        id: `${id}:${p}`,
        ledgerId: id,
        userId: u ? p : null,
        guestName: u ? null : p,
        nickname: u?.displayName ?? p,
        leftAt: null,
      });
    }
  };
  // `paise` is the total; rupees in the comment. `who` are people keys, `by` the payer.
  const spend = (
    l: string,
    desc: string,
    paise: Paise,
    by: string,
    who: string[],
    cat: string,
    daysAgo: number,
    split: { mode?: CreateExpense["mode"]; values?: number[] } = {},
  ) => {
    const body: CreateExpense = {
      description: desc,
      total: paise,
      paidAtEpochMs: now - daysAgo * DAY,
      categoryId: cat,
      notes: null,
      payerMemberId: `${l}:${by}`,
      mode: split.mode ?? "equal",
      participants: who.map((w, i) => ({ memberId: `${l}:${w}`, value: split.values?.[i] })),
    };
    S.expenses.push({
      id: uuidv7(),
      ledgerId: l,
      description: desc,
      total: paise,
      paidAt: body.paidAtEpochMs,
      payerMemberId: body.payerMemberId,
      categoryId: cat,
      notes: null,
      mode: body.mode,
      splits: resolve(S, l, body),
    });
  };
  const settle = (l: string, from: string, to: string, paise: Paise, daysAgo: number) =>
    S.settlements.push({
      id: uuidv7(),
      ledgerId: l,
      fromMemberId: `${l}:${from}`,
      toMemberId: `${l}:${to}`,
      amount: paise,
      method: "upi",
      note: null,
      declaredAt: now - daysAgo * DAY,
    });

  const goa = ["demo-me", "demo-asha", "demo-ravi", "demo-meera", "Karthik"];
  const flat = ["demo-me", "demo-ravi", "demo-meera"];
  const pair = ["demo-me", "demo-asha"];
  ledger("demo-goa", "Goa trip", "🏖️", "sky", goa);
  ledger("demo-flat", "Flat 4B", "🏠", "moss", flat);
  ledger("demo-pair", "Asha and me", "☕", "plum", pair);
  S.ledgers[0]!.pinned = true;

  // Goa trip. 2_400_000 paise = Rs 24,000.
  spend("demo-goa", "Beach villa", 2_400_000, "demo-asha", goa, "c-stay", 21);
  spend("demo-goa", "Seafood dinner", 420_000, "demo-me", goa, "c-food", 20); // Rs 4,200
  spend("demo-goa", "Airport cab", 150_000, "demo-meera", goa.slice(0, 4), "c-transport", 21); // Rs 1,500
  spend("demo-goa", "Scooter rental", 180_000, "demo-ravi", goa.slice(0, 3), "c-transport", 19, {
    mode: "shares",
    values: [2, 1, 1],
  }); // Rs 1,800
  spend("demo-goa", "Beach shack drinks", 260_000, "Karthik", goa, "c-fun", 19); // Rs 2,600
  // Flat 4B.
  spend("demo-flat", "Rent", 3_600_000, "demo-me", flat, "c-bills", 14); // Rs 36,000
  spend("demo-flat", "Electricity", 240_000, "demo-ravi", flat, "c-bills", 9); // Rs 2,400
  spend("demo-flat", "Groceries", 186_000, "demo-meera", flat, "c-groceries", 4); // Rs 1,860
  spend("demo-flat", "WiFi", 99_900, "demo-me", flat, "c-bills", 2); // Rs 999
  settle("demo-flat", "demo-ravi", "demo-me", 500_000, 1); // Rs 5,000
  // Asha and me.
  spend("demo-pair", "Coffee", 32_000, "demo-me", pair, "c-food", 6); // Rs 320
  spend("demo-pair", "Movie tickets", 70_000, "demo-asha", pair, "c-fun", 3); // Rs 700
  spend("demo-pair", "Birthday gift", 150_000, "demo-me", pair, "c-fun", 1, {
    mode: "exact",
    values: [50_000, 100_000],
  }); // Rs 1,500: Rs 500 mine, Rs 1,000 Asha's

  const goaDinner = S.expenses.find((e) => e.description === "Seafood dinner")!;
  S.comments.push({
    id: uuidv7(),
    expenseId: goaDinner.id,
    body: "Best dinner of the trip.",
    authorUserId: "demo-asha",
    authorName: "Asha",
    createdAt: now - 19 * DAY,
  });
  return S;
}

let S: State = seed();

/* ---------- derivations (same code the server uses) ---------- */

const live = (l: string) => S.members.filter((m) => m.ledgerId === l);
const viewer = (l: string) => live(l).find((m) => m.userId === ME);
const ledgerOf = (id: string) => {
  const l = S.ledgers.find((x) => x.id === id);
  if (!l) throw new ApiError(404, "not found", "not_found");
  return l;
};
const posOf = (l: string) =>
  netPositions(
    S.expenses.filter((e) => e.ledgerId === l),
    S.settlements.filter((s) => s.ledgerId === l),
  );

function summary(l: DLedger): LedgerSummary {
  const v = viewer(l.id);
  return {
    ...l,
    memberCount: live(l.id).filter((m) => m.leftAt === null).length,
    net: posOf(l.id).find((p) => p.memberId === v?.id)?.net ?? 0,
    spent: S.expenses.filter((e) => e.ledgerId === l.id && e.total > 0).reduce((a, e) => a + e.total, 0),
  };
}

const month = (ms: number) => new Date(ms).toISOString().slice(0, 7);

function byCategory(rows: Array<{ categoryId: string | null; spent: Paise }>) {
  const acc = new Map<string | null, { spent: Paise; count: number }>();
  for (const r of rows) {
    const a = acc.get(r.categoryId) ?? { spent: 0, count: 0 };
    acc.set(r.categoryId, { spent: a.spent + r.spent, count: a.count + 1 });
  }
  return [...acc]
    .map(([categoryId, a]) => {
      const c = S.categories.find((x) => x.id === categoryId);
      return { categoryId, name: c?.name ?? t("insights.noCategory"), icon: c?.icon ?? null, ...a };
    })
    .sort((a, b) => b.spent - a.spent);
}

function byMonth(rows: Array<{ at: number; spent: Paise }>) {
  const acc = new Map<string, Paise>();
  for (const r of rows) acc.set(month(r.at), (acc.get(month(r.at)) ?? 0) + r.spent);
  return [...acc].map(([m, spent]) => ({ month: m, spent })).sort((a, b) => a.month.localeCompare(b.month));
}

function activity(ledgerIds: string[], withLedger: boolean): ActivityEvent[] {
  const name = (l: string, id: string) => S.members.find((m) => m.id === id && m.ledgerId === l)?.nickname ?? null;
  const out: ActivityEvent[] = [];
  for (const l of ledgerIds) {
    const extra = withLedger ? { ledgerId: l, ledgerName: ledgerOf(l).name } : {};
    for (const e of S.expenses.filter((x) => x.ledgerId === l))
      out.push({
        id: `a-${e.id}`,
        kind: "added",
        at: e.paidAt,
        actorName: name(l, e.payerMemberId),
        description: e.description,
        amount: e.total,
        fromName: null,
        toName: null,
        expenseId: e.id,
        ...extra,
      });
    for (const s of S.settlements.filter((x) => x.ledgerId === l))
      out.push({
        id: `a-${s.id}`,
        kind: s.method === "forgiven" ? "forgave" : "settled",
        at: s.declaredAt,
        actorName: name(l, s.fromMemberId),
        description: s.note,
        amount: s.amount,
        fromName: name(l, s.fromMemberId),
        toName: name(l, s.toMemberId),
        expenseId: null,
        ...extra,
      });
  }
  return out.sort((a, b) => b.at - a.at).slice(0, 50);
}

/* ---------- router ---------- */

function parse<T>(schema: ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new ApiError(422, r.error.issues[0]?.message ?? "invalid", "invalid");
  return r.data;
}

const ok = { ok: true } as const;

function handle(path: string, init?: RequestInit): unknown {
  const method = init?.method ?? "GET";
  const [pathname = "", qs = ""] = path.replace(/^\/api/, "").split("?");
  const q = new URLSearchParams(qs);
  const body: unknown = init?.body ? JSON.parse(String(init.body)) : {};
  const key = `${method} ${pathname}`;
  let m: RegExpExecArray | null = null;
  const hit = (r: RegExp) => (m = r.exec(key)) !== null;
  const g = (i: number): string => m![i]!;
  const opt = (i: number) => (m as RegExpExecArray | null)?.[i];
  const num = (k: string) => (q.has(k) ? Number(q.get(k)) : null);

  /* me */
  if (key === "GET /me") {
    return {
      id: ME,
      displayName: S.me.displayName,
      vpa: S.me.vpa,
      isOwner: false,
      accountType: "full",
      email: null,
      hasPassword: true,
      credentials: [],
    } satisfies Me;
  }
  if (key === "PATCH /me") {
    const b = parse(updateProfileSchema, body);
    if (b.displayName !== undefined) S.me.displayName = b.displayName;
    if (b.vpa !== undefined) S.me.vpa = b.vpa;
    return handle("/api/me");
  }
  if (key === "POST /auth/logout") {
    exitDemo();
    return ok;
  }
  if (key === "GET /push/key") return { publicKey: null };

  /* ledgers */
  if (key === "GET /ledgers") return S.ledgers.map(summary);
  if (key === "POST /ledgers") {
    const b = parse(createLedgerSchema, body);
    const id = uuidv7();
    S.ledgers.unshift({
      id,
      name: b.name,
      endDate: b.endDate,
      budget: b.budget,
      archivedAt: null,
      invitesEnabled: b.invitesEnabled ?? false,
      color: b.color,
      emoji: b.emoji,
      pinned: false,
    });
    const people = b.cloneFrom ? live(b.cloneFrom).filter((x) => x.leftAt === null) : [];
    const keep = people.length ? people : [{ userId: ME, guestName: null, nickname: S.me.displayName }];
    for (const p of keep)
      S.members.push({
        id: uuidv7(),
        ledgerId: id,
        userId: p.userId,
        guestName: p.guestName,
        nickname: p.nickname,
        leftAt: null,
      });
    return summary(ledgerOf(id));
  }
  if (hit(/^(GET|PATCH|DELETE) \/ledgers\/([^/]+)$/)) {
    const l = ledgerOf(g(2));
    if (g(1) === "PATCH") Object.assign(l, parse(updateLedgerSchema, body));
    if (g(1) === "DELETE") {
      S.ledgers = S.ledgers.filter((x) => x !== l);
      S.members = S.members.filter((x) => x.ledgerId !== l.id);
      S.expenses = S.expenses.filter((x) => x.ledgerId !== l.id);
      S.settlements = S.settlements.filter((x) => x.ledgerId !== l.id);
      return ok;
    }
    return summary(l);
  }
  if (hit(/^POST \/ledgers\/([^/]+)\/(pin|archive|reopen)$/)) {
    const l = ledgerOf(g(1));
    if (g(2) === "pin") l.pinned = parse(pinLedgerSchema, body).pinned;
    else if (g(2) === "reopen") l.archivedAt = null;
    else {
      if (posOf(l.id).some((p) => p.net !== 0)) throw new ApiError(409, t("demo.notSettled"), "not_settled");
      l.archivedAt = Date.now();
    }
    return summary(l);
  }

  /* members */
  if (hit(/^GET \/ledgers\/([^/]+)\/members$/)) return live(ledgerOf(g(1)).id);
  if (hit(/^GET \/ledgers\/([^/]+)\/addable-users$/)) return [];
  if (hit(/^POST \/ledgers\/([^/]+)\/guests$/)) {
    const mem: DMember = {
      id: uuidv7(),
      ledgerId: ledgerOf(g(1)).id,
      userId: null,
      guestName: parse(addGuestSchema, body).guestName,
      nickname: "",
      leftAt: null,
    };
    mem.nickname = mem.guestName!;
    S.members.push(mem);
    return mem;
  }
  if (hit(/^POST \/ledgers\/([^/]+)\/leave$/) || hit(/^DELETE \/ledgers\/([^/]+)\/members\/([^/]+)$/)) {
    const l = ledgerOf(g(1));
    const target = opt(2);
    const who = target ? live(l.id).find((x) => x.id === target) : viewer(l.id);
    if (!who) throw new ApiError(404, "not found", "not_found");
    if (posOf(l.id).some((p) => p.memberId === who.id && p.net !== 0))
      throw new ApiError(409, t("demo.notSettled"), "non_zero_position");
    who.leftAt = Date.now();
    return ok;
  }

  /* expenses */
  if (hit(/^GET \/ledgers\/([^/]+)\/expenses$/)) {
    const l = ledgerOf(g(1)).id;
    const text = q.get("q")?.toLowerCase();
    const from = num("from");
    const to = num("to");
    return S.expenses
      .filter((e) => e.ledgerId === l)
      .filter((e) => !text || e.description.toLowerCase().includes(text))
      .filter((e) => !q.get("categoryId") || e.categoryId === q.get("categoryId"))
      .filter(
        (e) =>
          !q.get("memberId") ||
          e.payerMemberId === q.get("memberId") ||
          e.splits.some((s) => s.memberId === q.get("memberId")),
      )
      .filter((e) => (from === null || e.paidAt >= from) && (to === null || e.paidAt <= to))
      .sort((a, b) => b.paidAt - a.paidAt);
  }
  if (hit(/^POST \/ledgers\/([^/]+)\/expenses$/)) {
    const l = ledgerOf(g(1)).id;
    const b = parse(createExpenseSchema, body);
    const e: DExpense = {
      id: uuidv7(),
      ledgerId: l,
      description: b.description,
      total: b.total,
      paidAt: b.paidAtEpochMs,
      payerMemberId: b.payerMemberId,
      categoryId: b.categoryId,
      notes: b.notes,
      mode: b.mode,
      splits: resolve(S, l, b),
    };
    S.expenses.push(e);
    return e;
  }
  if (hit(/^(PATCH|DELETE) \/ledgers\/([^/]+)\/expenses\/([^/]+)$/)) {
    const e = S.expenses.find((x) => x.id === g(3) && x.ledgerId === g(2));
    if (!e) throw new ApiError(404, "not found", "not_found");
    if (g(1) === "DELETE") {
      S.expenses = S.expenses.filter((x) => x !== e);
      S.comments = S.comments.filter((c) => c.expenseId !== e.id);
      return { id: e.id };
    }
    const b = parse(createExpenseSchema, body);
    Object.assign(e, {
      description: b.description,
      total: b.total,
      paidAt: b.paidAtEpochMs,
      payerMemberId: b.payerMemberId,
      categoryId: b.categoryId,
      notes: b.notes,
      mode: b.mode,
      splits: resolve(S, e.ledgerId, b),
    });
    return e;
  }
  if (hit(/^GET \/ledgers\/([^/]+)\/expenses\/([^/]+)\/revisions$/)) return [];

  /* comments */
  if (hit(/^GET \/ledgers\/([^/]+)\/expenses\/([^/]+)\/comments$/))
    return S.comments.filter((c) => c.expenseId === g(2)).sort((a, b) => a.createdAt - b.createdAt);
  if (hit(/^POST \/ledgers\/([^/]+)\/expenses\/([^/]+)\/comments$/)) {
    const c: DComment = {
      id: uuidv7(),
      expenseId: g(2),
      body: parse(createCommentSchema, body).body,
      authorUserId: ME,
      authorName: S.me.displayName,
      createdAt: Date.now(),
    };
    S.comments.push(c);
    return c;
  }
  if (hit(/^DELETE \/ledgers\/([^/]+)\/comments\/([^/]+)$/)) {
    S.comments = S.comments.filter((c) => c.id !== g(2));
    return { id: g(2) };
  }

  /* balances + settlements */
  if (hit(/^GET \/ledgers\/([^/]+)\/balances$/)) {
    const l = ledgerOf(g(1)).id;
    const expenses = S.expenses.filter((e) => e.ledgerId === l);
    const settlements = S.settlements.filter((s) => s.ledgerId === l);
    const positions = netPositions(expenses, settlements);
    return {
      positions,
      transfers: transferPlan(positions).map((tr) => ({
        ...tr,
        trail: trailFor(expenses, settlements, tr.fromMemberId, tr.toMemberId),
      })),
      pairs: grossPairs(expenses, settlements),
    };
  }
  if (hit(/^POST \/ledgers\/([^/]+)\/settlements$/)) {
    const b = parse(createSettlementSchema, body);
    const l = ledgerOf(g(1)).id;
    const ids = new Set(live(l).map((x) => x.id));
    if (!ids.has(b.fromMemberId) || !ids.has(b.toMemberId)) throw new ApiError(422, "unknown member", "invalid");
    const s: DSettlement = { id: uuidv7(), ledgerId: l, ...b, declaredAt: Date.now() };
    S.settlements.push(s);
    return { id: s.id };
  }
  if (key === "GET /balances") {
    // Same rule as the server: each ledger contributes the leg of its own
    // transfer plan between the viewer and that person. Guests are left out.
    const net = new Map<string, Paise>();
    for (const l of S.ledgers) {
      const v = viewer(l.id);
      if (!v) continue;
      for (const tr of transferPlan(posOf(l.id))) {
        const mine = tr.fromMemberId === v.id ? 1 : tr.toMemberId === v.id ? -1 : 0;
        if (mine === 0) continue;
        const other = live(l.id).find((x) => x.id === (mine === 1 ? tr.toMemberId : tr.fromMemberId));
        if (!other?.userId || other.userId === ME) continue;
        net.set(other.userId, (net.get(other.userId) ?? 0) + mine * tr.amount);
      }
    }
    return [...net].flatMap(([userId, amount]) => {
      const u = S.people.get(userId);
      return u && amount !== 0 ? [{ userId, displayName: u.displayName, vpa: u.vpa, net: amount }] : [];
    });
  }

  /* categories */
  if (key === "GET /categories") return S.categories;
  if (key === "POST /categories") {
    const c: Category = { id: uuidv7(), ...parse(createCategorySchema, body), isDefault: false };
    S.categories.push(c);
    return c;
  }
  if (hit(/^DELETE \/categories\/([^/]+)$/)) {
    S.categories = S.categories.filter((c) => c.id !== g(1));
    for (const e of S.expenses) if (e.categoryId === g(1)) e.categoryId = null;
    return { id: g(1) };
  }

  /* insights + activity */
  if (key === "GET /insights") {
    const from = num("from");
    const to = num("to");
    const mine = S.expenses
      .filter((e) => (from === null || e.paidAt >= from) && (to === null || e.paidAt <= to))
      .flatMap((e) => {
        const v = viewer(e.ledgerId);
        const share = e.splits.find((s) => s.memberId === v?.id)?.amount;
        return v && (share !== undefined || e.payerMemberId === v.id) ? [{ e, v, spent: share ?? 0 }] : [];
      });
    const withUser = new Map<string, { count: number; total: Paise }>();
    for (const { e } of mine)
      for (const s of e.splits) {
        const u = S.members.find((x) => x.id === s.memberId)?.userId;
        if (!u || u === ME) continue;
        const a = withUser.get(u) ?? { count: 0, total: 0 };
        withUser.set(u, { count: a.count + 1, total: a.total + e.total });
      }
    return {
      totals: {
        spent: mine.reduce((a, r) => a + r.spent, 0),
        paid: mine.filter((r) => r.e.payerMemberId === r.v.id).reduce((a, r) => a + r.e.total, 0),
        expenseCount: mine.length,
        ledgerCount: new Set(mine.map((r) => r.e.ledgerId)).size,
      },
      byCategory: byCategory(mine.map((r) => ({ categoryId: r.e.categoryId, spent: r.spent }))),
      byMonth: byMonth(mine.map((r) => ({ at: r.e.paidAt, spent: r.spent }))),
      mostSpentWith: [...withUser]
        .map(([userId, a]) => ({
          userId,
          displayName: S.people.get(userId)?.displayName ?? "",
          sharedExpenseCount: a.count,
          sharedTotal: a.total,
        }))
        .sort((a, b) => b.sharedTotal - a.sharedTotal),
    };
  }
  if (hit(/^GET \/ledgers\/([^/]+)\/insights$/)) {
    const l = ledgerOf(g(1)).id;
    const es = S.expenses.filter((e) => e.ledgerId === l);
    return {
      totals: { spent: es.reduce((a, e) => a + e.total, 0), expenseCount: es.length },
      byCategory: byCategory(es.map((e) => ({ categoryId: e.categoryId, spent: e.total }))),
      byMonth: byMonth(es.map((e) => ({ at: e.paidAt, spent: e.total }))),
      byMember: live(l).map((mem) => ({
        memberId: mem.id,
        nickname: mem.nickname,
        paid: es.filter((e) => e.payerMemberId === mem.id).reduce((a, e) => a + e.total, 0),
        share: es.reduce((a, e) => a + (e.splits.find((s) => s.memberId === mem.id)?.amount ?? 0), 0),
      })),
    };
  }
  if (hit(/^GET \/ledgers\/([^/]+)\/activity$/)) return activity([ledgerOf(g(1)).id], false);
  if (key === "GET /activity")
    return activity(
      S.ledgers.map((l) => l.id),
      true,
    ).slice(0, 20);
  if (hit(/^GET \/ledgers\/([^/]+)\/recurring$/)) return [] satisfies Series[];

  throw new ApiError(403, t("demo.unavailable"), "demo");
}

/** Drop-in for `api()`. Cloned both ways so a caller can never mutate the store. */
export function demoApi<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    return Promise.resolve(structuredClone(handle(path, init)) as T);
  } catch (e) {
    return Promise.reject(e);
  }
}
