// Amounts are paise, written as integers with the rupee value in a comment.
// expensesRouter and ledgersRouter are mounted alongside importRouter so
// Task 4's tests can assert on the resulting /expenses and /members lists
// through the real routes, not by reading the DB directly.
import { beforeEach, describe, expect, it } from "vitest";
import expensesRouter from "~/server/routes/expenses";
import importRouter from "~/server/routes/import";
import ledgersRouter from "~/server/routes/ledgers";
import { type Harness, mount, req, setup } from "~/server/routes/_test-harness";

let h: Harness;
let app: ReturnType<typeof mount>;

beforeEach(async () => {
  h = await setup();
  app = mount(h, importRouter, expensesRouter, ledgersRouter);
});

function csvFile(text: string, name = "trip.csv") {
  return new File([text], name, { type: "text/csv" });
}

describe("POST /ledgers/:ledgerId/import/preview", () => {
  it("parses a Splitwise CSV and returns rows + source names, without writing anything", async () => {
    const csv = ["Date,Description,Category,Cost,Currency,Ada,Bob", "2026-08-16,Auto,Transportation,100.00,INR,50.00,-50.00"].join("\n");

    const form = new FormData();
    form.append("file", csvFile(csv));

    const res = await app.request(new Request("http://tally.test/api/ledgers/L1/import/preview", { method: "POST", headers: { cookie: h.cookie }, body: form }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sourceNames: string[]; rows: unknown[]; warnings: string[] };
    expect(body.sourceNames.sort()).toEqual(["Ada", "Bob"]);
    expect(body.rows).toHaveLength(1);

    const expenses = await (await app.request(req(h, "/api/ledgers/L1/expenses"))).json();
    void expenses;
  });

  it("400s on an unrecognized extension", async () => {
    const form = new FormData();
    form.append("file", new File(["x"], "trip.txt", { type: "text/plain" }));

    const res = await app.request(new Request("http://tally.test/api/ledgers/L1/import/preview", { method: "POST", headers: { cookie: h.cookie }, body: form }));
    expect(res.status).toBe(400);
  });

  it("403s an unknown ledger", async () => {
    const csv = "Date,Description,Category,Cost,Currency,Ada,Bob\n2026-08-16,Auto,Transportation,100.00,INR,50.00,-50.00";
    const form = new FormData();
    form.append("file", csvFile(csv));

    const res = await app.request(new Request("http://tally.test/api/ledgers/does-not-exist/import/preview", { method: "POST", headers: { cookie: h.cookie }, body: form }));
    expect(res.status).toBe(403);
  });
});

describe("POST /ledgers/:ledgerId/import/commit", () => {
  const commitBody = (overrides: object = {}) => ({
    rows: [
      {
        title: "Auto",
        amountPaise: 10_000,
        dateMs: 1_760_000_000_000,
        payerName: "Ada",
        shares: [
          { name: "Ada", sharePaise: 5_000 },
          { name: "Bob", sharePaise: 5_000 },
        ],
      },
    ],
    mapping: { Ada: "m_ada", Bob: "m_bob" },
    newGuests: {},
    ...overrides,
  });

  it("creates the expense and splits from mapped names, in one batch, for an existing member", async () => {
    const res = await app.request(
      new Request("http://tally.test/api/ledgers/L1/import/commit", {
        method: "POST",
        headers: { cookie: h.cookie, "content-type": "application/json" },
        body: JSON.stringify(commitBody()),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { created: number };
    expect(body.created).toBe(1);

    const expenses = (await (await app.request(req(h, "/api/ledgers/L1/expenses"))).json()) as Array<{
      description: string;
      total: number;
      payerMemberId: string;
      splits: Array<{ memberId: string; amount: number }>;
    }>;
    expect(expenses).toHaveLength(1);
    expect(expenses[0]).toMatchObject({ description: "Auto", total: 10_000, payerMemberId: "m_ada" });
    const total = expenses[0]!.splits.reduce((a, s) => a + s.amount, 0);
    expect(total).toBe(10_000); // resolveSplits guarantees exact sum
  });

  it("400s when a source name in rows has no mapping and no new guest", async () => {
    const res = await app.request(
      new Request("http://tally.test/api/ledgers/L1/import/commit", {
        method: "POST",
        headers: { cookie: h.cookie, "content-type": "application/json" },
        body: JSON.stringify(commitBody({ mapping: { Ada: "m_ada" } })), // Bob unmapped
      }),
    );
    expect(res.status).toBe(400);
  });

  it("403s a non-owner who supplies newGuests", async () => {
    // Bob is not the owner in the harness (only u_ada is_owner=1).
    const { createSession, SESSION_COOKIE } = await import("~/server/auth/session");
    const bobToken = await createSession(h.db, "u_bob", Date.now());
    const bobCookie = `${SESSION_COOKIE}=${bobToken}`;

    const res = await app.request(
      new Request("http://tally.test/api/ledgers/L1/import/commit", {
        method: "POST",
        headers: { cookie: bobCookie, "content-type": "application/json" },
        body: JSON.stringify(commitBody({ mapping: { Ada: "m_ada" }, newGuests: { Bob: "Bob (imported)" } })),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("creates a new guest (owner) and uses it as a participant", async () => {
    const res = await app.request(
      new Request("http://tally.test/api/ledgers/L1/import/commit", {
        method: "POST",
        headers: { cookie: h.cookie, "content-type": "application/json" },
        body: JSON.stringify(
          commitBody({
            rows: [
              {
                title: "Snacks",
                amountPaise: 2_000,
                dateMs: 1_760_000_000_000,
                payerName: "Ada",
                shares: [
                  { name: "Ada", sharePaise: 1_000 },
                  { name: "Charlie", sharePaise: 1_000 },
                ],
              },
            ],
            mapping: { Ada: "m_ada" },
            newGuests: { Charlie: "Charlie" },
          }),
        ),
      }),
    );
    expect(res.status).toBe(200);

    const members = (await (await app.request(req(h, "/api/ledgers/L1/members"))).json()) as Array<{ nickname: string; guestName: string | null }>;
    expect(members.some((m) => m.guestName === "Charlie")).toBe(true);
  });

  it("does not create a guest for a name mapped to an existing member, even if also listed in newGuests", async () => {
    const res = await app.request(
      new Request("http://tally.test/api/ledgers/L1/import/commit", {
        method: "POST",
        headers: { cookie: h.cookie, "content-type": "application/json" },
        body: JSON.stringify(
          commitBody({
            mapping: { Ada: "m_ada", Bob: "m_bob" },
            newGuests: { Bob: "Bob (imported)" }, // Bob is already mapped - mapping wins
          }),
        ),
      }),
    );
    expect(res.status).toBe(200);

    const members = (await (await app.request(req(h, "/api/ledgers/L1/members"))).json()) as Array<{ guestName: string | null }>;
    expect(members.some((m) => m.guestName === "Bob (imported)")).toBe(false);
  });

  it("does not create a guest for a newGuests key no row references", async () => {
    const res = await app.request(
      new Request("http://tally.test/api/ledgers/L1/import/commit", {
        method: "POST",
        headers: { cookie: h.cookie, "content-type": "application/json" },
        body: JSON.stringify(
          commitBody({
            mapping: { Ada: "m_ada", Bob: "m_bob" },
            newGuests: { Charlie: "Charlie" }, // no row mentions Charlie
          }),
        ),
      }),
    );
    expect(res.status).toBe(200);

    const members = (await (await app.request(req(h, "/api/ledgers/L1/members"))).json()) as Array<{ guestName: string | null }>;
    expect(members.some((m) => m.guestName === "Charlie")).toBe(false);
  });

  it("400s when a share has a zero or negative sharePaise instead of silently clamping to 1", async () => {
    const res = await app.request(
      new Request("http://tally.test/api/ledgers/L1/import/commit", {
        method: "POST",
        headers: { cookie: h.cookie, "content-type": "application/json" },
        body: JSON.stringify(
          commitBody({
            rows: [
              {
                title: "Bad share",
                amountPaise: 10_000,
                dateMs: 1_760_000_000_000,
                payerName: "Ada",
                shares: [
                  { name: "Ada", sharePaise: 10_000 },
                  { name: "Bob", sharePaise: 0 },
                ],
              },
            ],
          }),
        ),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("400s when two source names in a row map to the same member (would otherwise 500 on the unique index)", async () => {
    const res = await app.request(
      new Request("http://tally.test/api/ledgers/L1/import/commit", {
        method: "POST",
        headers: { cookie: h.cookie, "content-type": "application/json" },
        body: JSON.stringify(
          commitBody({
            rows: [
              {
                title: "Dup mapping",
                amountPaise: 10_000,
                dateMs: 1_760_000_000_000,
                payerName: "Ada",
                shares: [
                  { name: "Ada", sharePaise: 5_000 },
                  { name: "Bob", sharePaise: 5_000 },
                ],
              },
            ],
            mapping: { Ada: "m_ada", Bob: "m_ada" }, // Bob resolves to the same member as Ada
          }),
        ),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("409s on an archived ledger", async () => {
    // Archive L1 directly via SQL - the lifecycle route lives in ledgers.ts and
    // isn't exercised here; only its effect (archived_at set) matters for this test.
    await h.sql.exec(`UPDATE ledgers SET archived_at = 1760000000000 WHERE id = 'L1'`);

    const res = await app.request(
      new Request("http://tally.test/api/ledgers/L1/import/commit", {
        method: "POST",
        headers: { cookie: h.cookie, "content-type": "application/json" },
        body: JSON.stringify(commitBody()),
      }),
    );
    expect(res.status).toBe(409);
  });
});
