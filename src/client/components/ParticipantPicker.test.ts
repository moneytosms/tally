// The picker is the only way to exclude someone from a split, so "who is in"
// has to be readable from the markup alone - not from colour, and not from
// whether a row happens to be present.
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ParticipantPicker } from "./ParticipantPicker";
import { t } from "~/client/i18n";

const roster = [
  { id: "a", name: "Asha" },
  { id: "b", name: "Bo" },
  { id: "c", name: "Cy" },
];

const render = (selectedIds: string[]) =>
  renderToStaticMarkup(createElement(ParticipantPicker, { members: roster, selectedIds, onChange: () => {} }));

describe("<ParticipantPicker>", () => {
  it("keeps excluded people on screen rather than hiding them", () => {
    const html = render(["a"]);
    for (const m of roster) expect(html).toContain(m.name);
  });

  it("states inclusion in the markup, not only in colour", () => {
    const html = render(["a"]);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain(t("expense.exclude", { name: "Asha" }));
    expect(html).toContain(t("expense.include", { name: "Bo" }));
  });

  it("offers the everyone shortcut only when someone is left out", () => {
    expect(render(["a"])).toContain(t("expense.everyone"));
    expect(render(["a", "b", "c"])).not.toContain(t("expense.everyone"));
  });
});
