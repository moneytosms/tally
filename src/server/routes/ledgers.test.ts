// Creating a ledger by cloning the members of one you are already in (SPEC §8,
// "clone members on ledger creation"). The seed ledger L1 holds Ada, Bob and the
// guest Dee, and the session is Ada's.
import { beforeEach, describe, expect, it } from "vitest";
import ledgers from "~/server/routes/ledgers";
import { type Harness, mount, req, setup } from "~/server/routes/_test-harness";

let h: Harness;
let app: ReturnType<typeof mount>;

beforeEach(async () => {
  h = await setup();
  app = mount(h, ledgers);
});

const create = (json: object) => app.request(req(h, "/api/ledgers", { method: "POST", json }));

describe("POST /ledgers with cloneFrom", () => {
  it("copies the current members of the source ledger", async () => {
    const res = await create({ name: "Goa", cloneFrom: "L1" });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };

    const members = await h.db.listMembers(id);
    // Ada (the creator, whose own row carries no nickname), Bob, and the guest Dee.
    expect(members).toHaveLength(3);
    expect(members.filter((m) => m.userId !== null).map((m) => m.userId).sort()).toEqual(["u_ada", "u_bob"]);
    expect(members.filter((m) => m.guestName !== null).map((m) => m.guestName)).toEqual(["Dee"]);
    expect(members.filter((m) => m.userId === "u_ada")).toHaveLength(1);
  });

  it("clones a guest as a guest, never as a principal", async () => {
    const { id } = (await (await create({ name: "Goa", cloneFrom: "L1" })).json()) as { id: string };
    const dee = (await h.db.listMembers(id)).find((m) => m.guestName === "Dee");
    expect(dee?.userId).toBeNull();
  });

  it("does not carry over a member who has left", async () => {
    h.sql.prepare("UPDATE ledger_members SET left_at = ? WHERE id = ?").run(Date.now(), "m_bob");
    const { id } = (await (await create({ name: "Goa", cloneFrom: "L1" })).json()) as { id: string };
    expect((await h.db.listMembers(id)).some((m) => m.userId === "u_bob")).toBe(false);
  });

  it("refuses to clone a ledger the caller is not in", async () => {
    h.sql.prepare("UPDATE ledger_members SET left_at = ? WHERE id = ?").run(Date.now(), "n_ada");
    const res = await create({ name: "Goa", cloneFrom: "L2" });
    expect(res.status).toBe(403);
    // And nothing was created on the way to that refusal.
    const list = (await (await app.request(req(h, "/api/ledgers"))).json()) as unknown[];
    expect(list).toHaveLength(1); // L1 only: Ada left L2
  });

  it("creates a solo ledger when cloneFrom is omitted", async () => {
    const { id } = (await (await create({ name: "Goa" })).json()) as { id: string };
    expect(await h.db.listMembers(id)).toHaveLength(1);
  });
});

// Adding an existing user directly. Cy holds an account and is in L2 only, so
// he is the one addable user for L1.
describe("POST /ledgers/:ledgerId/members", () => {
  const add = (json: object) => app.request(req(h, "/api/ledgers/L1/members", { method: "POST", json }));

  it("adds an existing user as a real member, never a guest", async () => {
    const res = await add({ userId: "u_cy" });
    expect(res.status).toBe(201);
    const cy = (await h.db.listMembers("L1")).find((m) => m.userId === "u_cy");
    expect(cy?.guestName).toBeNull();
  });

  it("404s for a user that does not exist", async () => {
    expect((await add({ userId: "u_nobody" })).status).toBe(404);
    expect(await h.db.listMembers("L1")).toHaveLength(3);
  });

  it("409s when they are already a current member", async () => {
    const res = await add({ userId: "u_bob" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("already_member");
  });

  it("makes someone who left current again, keeping their member row", async () => {
    h.sql.prepare("UPDATE ledger_members SET left_at = ? WHERE id = ?").run(Date.now(), "m_bob");
    const res = await add({ userId: "u_bob" });
    expect(res.status).toBe(201);
    // The same member id: expenses reference members, so a new row would orphan
    // Bob's share of everything already recorded.
    expect(((await res.json()) as { id: string }).id).toBe("m_bob");
    expect((await h.db.listMembers("L1")).some((m) => m.id === "m_bob")).toBe(true);
  });

  it("refuses a caller who is not a member of the ledger", async () => {
    h.sql.prepare("UPDATE ledger_members SET left_at = ? WHERE id = ?").run(Date.now(), "n_ada");
    const res = await app.request(req(h, "/api/ledgers/L2/members", { method: "POST", json: { userId: "u_bob" } }));
    expect(res.status).toBe(403);
  });
});

// Invite links are opt-in per ledger (ADR 0007). The seeded L1 predates the
// column, so it arrives with the default: off.
describe("per-ledger invite toggle", () => {
  const mint = (ledgerId = "L1") =>
    app.request(req(h, `/api/ledgers/${ledgerId}/invites`, { method: "POST", json: {} }));
  const patch = (json: object) => app.request(req(h, "/api/ledgers/L1", { method: "PATCH", json }));

  it("refuses to mint an invite while the flag is off", async () => {
    const res = await mint();
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("invites_disabled");
  });

  it("mints once the flag is on", async () => {
    expect((await patch({ invitesEnabled: true })).status).toBe(200);
    const res = await mint();
    expect(res.status).toBe(201);
    expect(((await res.json()) as { token: string }).token).toBeTruthy();
  });

  it("creates a ledger with invites on when asked, off by default", async () => {
    const on = (await (await create({ name: "Goa", invitesEnabled: true })).json()) as { id: string };
    expect((await h.db.findLedger(on.id))!.invitesEnabled).toBe(true);
    const off = (await (await create({ name: "Flat" })).json()) as { id: string };
    expect((await h.db.findLedger(off.id))!.invitesEnabled).toBe(false);
  });

  it("reports the flag on GET so the client can render the toggle", async () => {
    await patch({ invitesEnabled: true });
    const body = (await (await app.request(req(h, "/api/ledgers/L1"))).json()) as { invitesEnabled: boolean };
    expect(body.invitesEnabled).toBe(true);
  });

  it("kills an already-open invite when the flag is turned back off", async () => {
    await patch({ invitesEnabled: true });
    const { token } = (await (await mint()).json()) as { token: string };
    await patch({ invitesEnabled: false });
    // The token is a bearer credential: opting out has to reach the links
    // already handed out, not just stop new ones.
    const accept = await app.request(req(h, `/api/invites/${token}/accept`, { method: "POST", json: {} }));
    expect(accept.status).toBe(400);
  });

  it("refuses a caller who is not a member of the ledger", async () => {
    h.sql.prepare("UPDATE ledger_members SET left_at = ? WHERE id = ?").run(Date.now(), "n_ada");
    expect((await mint("L2")).status).toBe(403);
  });
});

describe("GET /ledgers/:ledgerId/addable-users", () => {
  const addable = async () =>
    (await (await app.request(req(h, "/api/ledgers/L1/addable-users"))).json()) as Array<Record<string, unknown>>;

  it("lists only users who are not already current members", async () => {
    expect((await addable()).map((u) => u.id)).toEqual(["u_cy"]);
  });

  it("never leaks a VPA - these people are not co-members yet", async () => {
    const [cy] = await addable();
    expect(cy).toEqual({ id: "u_cy", displayName: "Cy" });
  });

  it("offers someone who left the ledger again", async () => {
    h.sql.prepare("UPDATE ledger_members SET left_at = ? WHERE id = ?").run(Date.now(), "m_bob");
    expect((await addable()).map((u) => u.id).sort()).toEqual(["u_bob", "u_cy"]);
  });
});
