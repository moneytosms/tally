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
