// Pure-logic tests for the activity feed filter. Component rendering is not
// exercised anywhere in this repo (no jsdom/RTL setup) so the filter is kept
// as a plain function ActivityTab can call, and that function is what's tested.
import { describe, expect, it } from "vitest";
import { filterEvents } from "~/client/routes/ActivityTab";
import type { ActivityEvent } from "~/client/lib/queries";

const event = (overrides: Partial<ActivityEvent>): ActivityEvent => ({
  id: overrides.id ?? Math.random().toString(36),
  kind: "added",
  at: 0,
  actorName: null,
  description: null,
  amount: null,
  fromName: null,
  toName: null,
  expenseId: null,
  ...overrides,
});

const events: ActivityEvent[] = [
  event({ id: "1", kind: "added", actorName: "Priya", description: "Dinner" }),
  event({ id: "2", kind: "edited", actorName: "Priya", description: "Dinner" }),
  event({ id: "3", kind: "deleted", actorName: "Rahul", description: "Cab" }),
  event({ id: "4", kind: "settled", fromName: "Rahul", toName: "Priya" }),
  event({ id: "5", kind: "joined", actorName: "Meera" }),
];

describe("filterEvents", () => {
  it("returns every event when no filters are set", () => {
    expect(filterEvents(events, {})).toHaveLength(5);
  });

  it("narrows by member across actor/from/to", () => {
    // Rahul is the actor on #3 and the payer being settled on #4.
    const result = filterEvents(events, { member: "Rahul" });
    expect(result.map((e) => e.id)).toEqual(["3", "4"]);
  });

  it("narrows by event type", () => {
    const result = filterEvents(events, { kind: "edited" });
    expect(result.map((e) => e.id)).toEqual(["2"]);
  });

  it("combines member and type filters", () => {
    const result = filterEvents(events, { member: "Priya", kind: "added" });
    expect(result.map((e) => e.id)).toEqual(["1"]);
  });

  it("returns nothing when the combination matches no event", () => {
    const result = filterEvents(events, { member: "Meera", kind: "settled" });
    expect(result).toEqual([]);
  });
});
