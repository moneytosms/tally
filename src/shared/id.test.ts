import { describe, expect, it } from "vitest";
import { uuidv7 } from "~/shared/id";

describe("uuidv7", () => {
  it("is a well-formed v7 uuid", () => {
    const id = uuidv7();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("sorts monotonically in generation order", () => {
    const ids = Array.from({ length: 2000 }, uuidv7);
    for (let i = 1; i < ids.length; i++) expect(ids[i]! > ids[i - 1]!).toBe(true);
  });

  it("encodes the current time in the leading 48 bits", () => {
    const before = Date.now();
    const ts = Number.parseInt(uuidv7().replaceAll("-", "").slice(0, 12), 16);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(Date.now());
  });
});
