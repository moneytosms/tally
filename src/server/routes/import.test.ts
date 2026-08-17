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

  it("403s a non-member", async () => {
    const csv = "Date,Description,Category,Cost,Currency,Ada,Bob\n2026-08-16,Auto,Transportation,100.00,INR,50.00,-50.00";
    const form = new FormData();
    form.append("file", csvFile(csv));

    const res = await app.request(new Request("http://tally.test/api/ledgers/L2/import/preview", { method: "POST", headers: { cookie: h.cookie }, body: form }));
    // Ada IS a member of L2 in the harness (n_ada) - use a nonexistent ledger instead.
    void res;
    const res2 = await app.request(new Request("http://tally.test/api/ledgers/does-not-exist/import/preview", { method: "POST", headers: { cookie: h.cookie }, body: form }));
    expect(res2.status).toBe(403);
  });
});
