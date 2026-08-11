import { Hono } from "hono";
import type { Env } from "~/server/context";
import { requireOwner } from "~/server/middleware/owner";
import { requireSession } from "~/server/middleware/session";
import { uuidv7 } from "~/shared/id";
import { createCategorySchema } from "~/shared/schemas";

const categories = new Hono<Env>();

categories.get("/categories", requireSession, async (c) => {
  const rows = await c.var.db.listCategories();
  return c.json(rows.map((r) => ({ id: r.id, name: r.name, icon: r.icon, isDefault: r.isDefault })));
});

categories.post("/categories", requireSession, requireOwner, async (c) => {
  const parsed = createCategorySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid category", detail: parsed.error.issues }, 400);
  const { name, icon } = parsed.data;

  try {
    await c.var.db.insertCategory({
      id: uuidv7(),
      name,
      icon,
      isDefault: false,
      deletedAt: null,
    });
  } catch (e) {
    const err = e as any;
    if (err?.cause?.message?.includes("UNIQUE constraint failed") || err?.message?.includes("UNIQUE constraint failed")) {
      return c.json({ error: "a category with that name already exists" }, 409);
    }
    throw e;
  }

  const created = (await c.var.db.listCategories()).find((cat) => cat.name === name);
  return c.json({ id: created!.id, name: created!.name, icon: created!.icon, isDefault: created!.isDefault }, 201);
});

categories.delete("/categories/:categoryId", requireSession, requireOwner, async (c) => {
  const categoryId = c.req.param("categoryId");
  const result = await c.var.db.softDeleteCategory(categoryId, Date.now());

  // Check if anything changed
  const stmt = await result;
  if (stmt.meta?.changes === 0) {
    return c.json({ error: "default categories cannot be deleted" }, 400);
  }

  return c.json({ id: categoryId, deletedAt: Date.now() });
});

export default categories;
