// Who this expense is split between: one tap per person, on the ledger's own
// roster.
//
// This replaces a remove-button on every row plus a separate "add participant"
// dropdown - two controls, in two places, for one question. Leaving someone out
// is still the ONLY way to exclude them; there is no zero share (SPEC §5), and
// an unselected avatar says that more plainly than a row that had to be deleted.
//
// Excluded people stay on screen, dimmed. A picker that hides what you did not
// choose makes you remember the roster; this one shows it.
import { Avatar } from "~/client/components/ui";
import { focusRing } from "~/client/components/ui/focus";
import { t } from "~/client/i18n";

export type PickableMember = { id: string; name: string };

export function ParticipantPicker({
  members,
  selectedIds,
  onChange,
}: {
  members: PickableMember[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const selected = new Set(selectedIds);
  const allIn = members.length > 0 && members.every((m) => selected.has(m.id));

  // Toggling preserves ROSTER order rather than tap order. The order of
  // participants is what the remainder rule distributes against, so it must not
  // depend on the sequence someone happened to tap in.
  const toggle = (id: string) => {
    const next = selected.has(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id];
    const order = new Map(members.map((m, i) => [m.id, i]));
    onChange(next.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)));
  };

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-[11.5px]" style={{ color: "var(--ink-3)" }}>
          {t("expense.participants")}
        </span>
        {!allIn && (
          <button
            type="button"
            onClick={() => onChange(members.map((m) => m.id))}
            className={`rounded-[5px] px-1.5 py-0.5 text-[11.5px] ${focusRing}`}
            style={{ color: "var(--moss-2)" }}
          >
            {t("expense.everyone")}
          </button>
        )}
      </div>

      {/* Horizontal scroll, not a wrap: a wrapping grid reflows every avatar the
          moment one name is longer, and the row is the thing being scanned. */}
      <ul className="-mx-1 flex snap-x gap-1 overflow-x-auto px-1 pb-1">
        {members.map((m) => {
          const on = selected.has(m.id);
          return (
            <li key={m.id} className="snap-start">
              <button
                type="button"
                aria-pressed={on}
                aria-label={t(on ? "expense.exclude" : "expense.include", { name: m.name })}
                onClick={() => toggle(m.id)}
                className={`flex w-[68px] flex-col items-center gap-1 rounded-[8px] border px-1 py-2 ${focusRing}`}
                style={{
                  background: on ? "var(--moss-wash)" : "transparent",
                  borderColor: on ? "var(--moss)" : "var(--line)",
                  // Never colour alone: excluded avatars also fade and lose their
                  // border weight, which survives greyscale and colour blindness.
                  opacity: on ? 1 : 0.45,
                }}
              >
                <Avatar name={m.name} size={34} />
                <span
                  className="w-full truncate text-center text-[11px]"
                  style={{ color: on ? "var(--ink)" : "var(--ink-3)" }}
                >
                  {m.name}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
