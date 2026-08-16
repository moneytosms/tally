// The server default is OFF for every ledger (ADR 0007). Which kinds the create
// form overrides that for is the whole decision, so it is pinned here rather
// than living only inside a JSX default.
import { describe, expect, it } from "vitest";
import { invitesDefaultFor } from "./LedgerForm";

describe("invitesDefaultFor", () => {
  it("starts a trip and a pair with invites on", () => {
    expect(invitesDefaultFor("trip")).toBe(true);
    expect(invitesDefaultFor("pair")).toBe(true);
  });

  it("leaves a standing group on the server's off default", () => {
    expect(invitesDefaultFor("group")).toBe(false);
  });
});
