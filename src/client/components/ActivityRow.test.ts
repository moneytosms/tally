// The forgave sentence must name the creditor (toMemberId, who forgives) first.
// Server sends fromName = debtor, toName = creditor (src/server/routes/activity.ts).
import { describe, expect, it } from "vitest";
import { sentence } from "./ActivityRow";
import type { ActivityEvent } from "~/client/lib/queries";

const settlement = (kind: "settled" | "forgave"): ActivityEvent => ({
  id: "s1",
  kind,
  at: 1,
  actorName: null,
  description: null,
  amount: 5_000, // ₹50.00
  fromName: "Bob",
  toName: "Ada",
  expenseId: null,
});

describe("activity sentence", () => {
  it("forgave: creditor forgives debtor's debt", () => {
    expect(sentence(settlement("forgave"))).toBe("Ada forgave what Bob owed");
  });

  it("settled: debtor settled with creditor", () => {
    expect(sentence(settlement("settled"))).toBe("Bob settled with Ada");
  });
});
