import { beforeEach, describe, expect, it } from "vitest";
import { demoApi, enterDemo } from "./demo";
import type { Expense, LedgerBalances, LedgerSummary, Member } from "./queries";

const sum = (b: LedgerBalances) => b.positions.reduce((a, p) => a + p.net, 0);

describe("demo api", () => {
  beforeEach(() => enterDemo());

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

  it("refuses what demo does not support", async () => {
    await expect(demoApi("/api/admin/users")).rejects.toMatchObject({ code: "demo" });
  });
});
