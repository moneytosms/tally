import { beforeEach, describe, expect, it } from "vitest";
import { demoApi, enterDemo } from "./demo";
import type { AdminUser, Expense, LedgerBalances, LedgerSummary, Me, Member } from "./queries";

const sum = (b: LedgerBalances) => b.positions.reduce((a, p) => a + p.net, 0);

describe("demo api", () => {
  beforeEach(() => enterDemo());

  it("signs in as the Owner, so the admin panel has people to show", async () => {
    expect((await demoApi<Me>("/api/me")).isOwner).toBe(true);
    const users = await demoApi<AdminUser[]>("/api/admin/users");
    expect(users.filter((u) => u.isOwner).map((u) => u.id)).toEqual(["demo-me"]);
  });

  it("seeds ledgers whose derived balances sum to zero", async () => {
    const ledgers = await demoApi<LedgerSummary[]>("/api/ledgers");
    expect(ledgers.length).toBe(3);
    for (const l of ledgers) expect(sum(await demoApi<LedgerBalances>(`/api/ledgers/${l.id}/balances`))).toBe(0);
  });

  it("a new expense resolves splits and moves the balances", async () => {
    const [l] = await demoApi<LedgerSummary[]>("/api/ledgers");
    const members = await demoApi<Member[]>(`/api/ledgers/${l!.id}/members`);
    const before = l!.net;
    const body = {
      description: "Test",
      total: 100_001, // Rs 1,000.01, does not divide evenly
      paidAtEpochMs: Date.now(),
      categoryId: null,
      notes: null,
      payerMemberId: members.find((m) => m.userId === "demo-me")!.id,
      mode: "equal",
      participants: members.slice(0, 3).map((m) => ({ memberId: m.id })),
    };
    const e = await demoApi<Expense>(`/api/ledgers/${l!.id}/expenses`, { method: "POST", body: JSON.stringify(body) });
    expect(e.splits.reduce((a, s) => a + s.amount, 0)).toBe(100_001);
    const after = await demoApi<LedgerSummary>(`/api/ledgers/${l!.id}`);
    expect(after.net).toBeGreaterThan(before);
    expect(sum(await demoApi<LedgerBalances>(`/api/ledgers/${l!.id}/balances`))).toBe(0);
  });

  it("breaks each position into paid, share and settlements, and keeps the identity", async () => {
    const [l] = await demoApi<LedgerSummary[]>("/api/ledgers");
    const b = await demoApi<LedgerBalances>(`/api/ledgers/${l!.id}/balances`);
    for (const p of b.positions) expect(p.paid - p.share + p.settledOut - p.settledIn).toBe(p.net);
    expect(b.positions.every((p) => p.name.length > 0)).toBe(true);
  });

  it("sorts starred ledgers first, and starring reorders the list", async () => {
    await demoApi(`/api/ledgers/demo-pair/pin`, { method: "POST", body: JSON.stringify({ pinned: true }) });
    const flags = (await demoApi<LedgerSummary[]>("/api/ledgers")).map((l) => l.pinned);
    expect(flags).toEqual([...flags].sort((a, b) => Number(b) - Number(a)));
    expect(flags.filter(Boolean)).toHaveLength(2);
  });

  it("gives every ledger a lastActivityAt", async () => {
    for (const l of await demoApi<LedgerSummary[]>("/api/ledgers")) expect(l.lastActivityAt).toBeGreaterThan(0);
  });

  it("refuses what demo does not support", async () => {
    await expect(demoApi("/api/admin/users/demo-asha/promote", { method: "POST" })).rejects.toMatchObject({
      code: "demo",
    });
  });
});

describe("startDemo (the /demo deep link)", () => {
  it("turns demo mode on and drops cached real-account queries", async () => {
    const { exitDemo, isDemo, startDemo } = await import("./demo");
    exitDemo();
    let cleared = 0;
    startDemo({ clear: () => void cleared++ });
    expect(isDemo()).toBe(true);
    expect(cleared).toBe(1);
  });
});
