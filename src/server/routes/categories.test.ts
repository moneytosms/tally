import { beforeEach, describe, expect, it } from "vitest";
import categoriesRouter from "~/server/routes/categories";
import { type Harness, mount, req, setup } from "~/server/routes/_test-harness";

let h: Harness;
let app: ReturnType<typeof mount>;

beforeEach(async () => {
  h = await setup();
  app = mount(h, categoriesRouter);
});

describe("GET /categories", () => {
  it("returns all categories with id, name, icon, isDefault", async () => {
    const res = await app.request(req(h, "/api/categories"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string; name: string; icon: string; isDefault: boolean }>;
    expect(body.length).toBe(10); // 10 seeded defaults
    expect(body[0]).toHaveProperty("id");
    expect(body[0]).toHaveProperty("name");
    expect(body[0]).toHaveProperty("icon");
    expect(body[0]).toHaveProperty("isDefault");
    expect(body.some((c) => c.isDefault)).toBe(true);
  });

  it("requires a session", async () => {
    const res = await app.request(new Request("http://tally.test/api/categories"));
    expect(res.status).toBe(401);
  });
});

describe("POST /categories", () => {
  it("creates a new category and returns 201", async () => {
    const res = await app.request(
      req(h, "/api/categories", {
        method: "POST",
        json: { name: "Parking", icon: "🅿️" },
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; name: string; icon: string; isDefault: boolean };
    expect(body.name).toBe("Parking");
    expect(body.icon).toBe("🅿️");
    expect(body.isDefault).toBe(false);
    expect(body.id).toBeTruthy();
  });

  it("rejects duplicate category names", async () => {
    await app.request(
      req(h, "/api/categories", {
        method: "POST",
        json: { name: "NewCat", icon: "🆕" },
      }),
    );
    const res = await app.request(
      req(h, "/api/categories", {
        method: "POST",
        json: { name: "NewCat", icon: "🆕" },
      }),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("a category with that name already exists");
  });

  it("allows owner to create", async () => {
    const res = await app.request(
      req(h, "/api/categories", {
        method: "POST",
        json: { name: "OwnerCat", icon: "👑" },
      }),
    );
    // Ada is the owner in the test fixture, so this should succeed
    expect(res.status).toBe(201);
  });

  it("rejects non-owner trying to create", async () => {
    // Change to the u_bob session (non-owner)
    const { createSession } = await import("~/server/auth/session");
    const { SESSION_COOKIE } = await import("~/server/auth/session");
    const bobToken = await createSession(h.db, "u_bob", Date.now());
    const bobReq = new Request("http://tally.test/api/categories", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${bobToken}` },
      body: JSON.stringify({ name: "TestNonOwner", icon: "🧪" }),
    });
    const res = await app.request(bobReq);
    expect(res.status).toBe(403);
  });

  it("validates schema", async () => {
    const res = await app.request(
      req(h, "/api/categories", {
        method: "POST",
        json: { name: "", icon: "🆕" }, // empty name
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid category");
  });

  it("requires a session", async () => {
    const res = await app.request(
      new Request("http://tally.test/api/categories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Test", icon: "🧪" }),
      }),
    );
    expect(res.status).toBe(401);
  });
});

describe("DELETE /categories/:categoryId", () => {
  it("soft-deletes a category and returns id and deletedAt", async () => {
    // Create a category first
    const createRes = await app.request(
      req(h, "/api/categories", {
        method: "POST",
        json: { name: "Custom", icon: "🎨" },
      }),
    );
    const created = (await createRes.json()) as { id: string };

    const deleteRes = await app.request(req(h, `/api/categories/${created.id}`, { method: "DELETE" }));
    expect(deleteRes.status).toBe(200);
    const body = (await deleteRes.json()) as { id: string; deletedAt: number };
    expect(body.id).toBe(created.id);
    expect(body.deletedAt).toBeGreaterThan(0);
  });

  it("rejects deletion of default categories", async () => {
    const categories = await h.db.listCategories();
    const defaultCat = categories.find((c) => c.isDefault);
    expect(defaultCat).toBeDefined();

    const deleteRes = await app.request(req(h, `/api/categories/${defaultCat!.id}`, { method: "DELETE" }));
    expect(deleteRes.status).toBe(400);
    const body = (await deleteRes.json()) as { error: string };
    expect(body.error).toBe("default categories cannot be deleted");
  });

  it("requires owner for deletion", async () => {
    // Create a custom category first (as owner)
    const createRes = await app.request(
      req(h, "/api/categories", {
        method: "POST",
        json: { name: "DeleteTest", icon: "🗑️" },
      }),
    );
    const created = (await createRes.json()) as { id: string };

    // Try to delete as non-owner
    const { createSession } = await import("~/server/auth/session");
    const { SESSION_COOKIE } = await import("~/server/auth/session");
    const bobToken = await createSession(h.db, "u_bob", Date.now());
    const bobReq = new Request(`http://tally.test/api/categories/${created.id}`, {
      method: "DELETE",
      headers: { cookie: `${SESSION_COOKIE}=${bobToken}` },
    });
    const res = await app.request(bobReq);
    expect(res.status).toBe(403);
  });

  it("requires a session", async () => {
    const res = await app.request(
      new Request("http://tally.test/api/categories/some-id", {
        method: "DELETE",
      }),
    );
    expect(res.status).toBe(401);
  });
});
