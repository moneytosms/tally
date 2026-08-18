import { describe, expect, it } from "vitest";
import { guessMapping } from "~/client/lib/guessMapping";
import type { Member } from "~/client/lib/queries";

function member(id: string, nickname: string, guestName: string | null = null): Member {
  return { id, userId: guestName ? null : `u_${id}`, guestName, nickname, leftAt: null };
}

describe("guessMapping", () => {
  it("matches an exact nickname", () => {
    const members = [member("m1", "Ada")];
    expect(guessMapping(["Ada"], members)).toEqual({ Ada: "m1" });
  });

  it("matches regardless of case and surrounding whitespace", () => {
    const members = [member("m1", "Ada")];
    expect(guessMapping([" ADA  "], members)).toEqual({ " ADA  ": "m1" });
  });

  it("matches a partial/nickname form, e.g. first name against a full guest name", () => {
    const members = [member("m1", "Owner"), member("m2", "guest-2", "Bob Smith")];
    expect(guessMapping(["Bob"], members)).toEqual({ Bob: "m2" });
  });

  it("leaves an unrelated name unmapped", () => {
    const members = [member("m1", "Ada"), member("m2", "Bob")];
    expect(guessMapping(["Zephyr"], members)).toEqual({});
  });
});
