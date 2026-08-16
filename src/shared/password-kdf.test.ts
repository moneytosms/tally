import { describe, expect, it } from "vitest";
import { deriveAuthKey } from "~/shared/password-kdf";

describe("client-side key stretching", () => {
  it("is deterministic, so the same password works on every device", async () => {
    const a = await deriveAuthKey("a-long-enough-password", "eve@example.com");
    const b = await deriveAuthKey("a-long-enough-password", "eve@example.com");
    expect(a).toEqual(b);
  });

  it("normalises the email salt the way the server normalises the address", async () => {
    // A capital letter typed on a phone must not produce a different key from
    // the same password typed on a laptop - the server lowercases either way.
    const typed = await deriveAuthKey("a-long-enough-password", "  Eve@Example.COM ");
    const stored = await deriveAuthKey("a-long-enough-password", "eve@example.com");
    expect(typed).toEqual(stored);
  });

  it("is salted per account, so two people sharing a password do not share a key", async () => {
    const eve = await deriveAuthKey("a-long-enough-password", "eve@example.com");
    const bob = await deriveAuthKey("a-long-enough-password", "bob@example.com");
    expect(eve).not.toEqual(bob);
  });

  it("never returns the password itself", async () => {
    const key = await deriveAuthKey("a-long-enough-password", "eve@example.com");
    expect(key).not.toContain("password");
    // 256 bits, base64url, unpadded.
    expect(key).toMatch(/^[\w-]{43}$/);
  });
});
