import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "~/server/auth/password";

describe("password hashing", () => {
  it("round-trips a password", async () => {
    const stored = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse battery", stored)).toBe(true);
    expect(await verifyPassword("Correct horse battery", stored)).toBe(false);
  });

  it("salts, so the same password hashes differently every time", async () => {
    const a = await hashPassword("same password twice");
    const b = await hashPassword("same password twice");
    expect(a).not.toEqual(b);
    // Both still verify - the salt travels in the stored string.
    expect(await verifyPassword("same password twice", a)).toBe(true);
    expect(await verifyPassword("same password twice", b)).toBe(true);
  });

  it("carries its own iteration count, so raising the cost keeps old hashes valid", async () => {
    const stored = await hashPassword("iterations are in the string");
    const [scheme, digest, iterations] = stored.split("$");
    expect(scheme).toBe("pbkdf2");
    expect(digest).toBe("sha256");
    expect(Number(iterations)).toBeGreaterThan(0);
  });

  it("returns false rather than throwing on a null or malformed hash", async () => {
    expect(await verifyPassword("anything", null)).toBe(false);
    expect(await verifyPassword("anything", "")).toBe(false);
    expect(await verifyPassword("anything", "not-a-hash")).toBe(false);
    expect(await verifyPassword("anything", "pbkdf2$sha256$abc$salt$hash")).toBe(false);
    expect(await verifyPassword("anything", "bcrypt$sha256$1000$salt$hash")).toBe(false);
  });
});
