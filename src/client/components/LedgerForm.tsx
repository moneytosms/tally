// Create a ledger. SPEC has no ledger "type" column and this does not add one:
// a trip is a ledger with an end date, a group is one without, a one-on-one is
// one with two members. The kind only picks which fields are worth asking for,
// so nothing here can drift out of sync with the server's idea of a ledger.
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { Button, Field, Input, Rupees, Select, focusRing } from "~/client/components/ui";
import { rupeesToPaise } from "~/client/components/SplitEditor";
import { useCreateLedger, useLedgers, type LedgerColor } from "~/client/lib/queries";
import { LEDGER_COLOR_VALUES } from "~/shared/schemas";
import { t } from "~/client/i18n";

export type LedgerKind = "trip" | "group" | "pair";

/** Swatch hex per accent (issue #27). Deliberately fixed, not a CSS token -
 *  themes redefine --moss/--clay/--ochre globally, so a per-ledger accent needs
 *  colours that hold their identity no matter which theme is active. */
export const LEDGER_COLOR_SWATCH: Record<LedgerColor, string> = {
  moss: "#5c7355",
  clay: "#a85f42",
  ochre: "#b08344",
  plum: "#7d5a8c",
  sky: "#3f7ea6",
  rose: "#b3557a",
};

/** End of the chosen day in LOCAL time - a trip ending "on the 5th" includes
 *  the 5th. Mirrors the local-day rule ExpenseForm uses for paidAt. */
const endOfLocalDay = (yyyymmdd: string) => new Date(`${yyyymmdd}T23:59:59`).getTime();

/** Invites are off by default server-side (ADR 0007), which is right for a
 *  standing group - its roster settled long ago and is filled from accounts that
 *  already exist. A trip or a new pair regularly needs someone who has no account
 *  yet, so leaving those off makes the very next step a settings hunt. */
export const invitesDefaultFor = (kind: LedgerKind) => kind !== "group";

export function LedgerForm({ kind, onDone }: { kind: LedgerKind; onDone: () => void }) {
  const create = useCreateLedger();
  const navigate = useNavigate();
  const ledgers = useLedgers();
  const [name, setName] = useState("");
  // Same crowd, new trip: copying members beats sending everyone a fresh invite
  // link. Only ledgers that have someone else in them are worth offering.
  const [cloneFrom, setCloneFrom] = useState("");
  const cloneable = (ledgers.data ?? []).filter((l) => l.memberCount > 1);
  const [endDate, setEndDate] = useState("");
  const [budgetRaw, setBudgetRaw] = useState("");
  const [invitesEnabled, setInvitesEnabled] = useState(() => invitesDefaultFor(kind));
  const [color, setColor] = useState<LedgerColor | null>(null);
  const [emoji, setEmoji] = useState("");
  const [failure, setFailure] = useState("");

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFailure("");
    if (!name.trim()) return setFailure(t("ledger.nameRequired"));
    // A trip without an end date silently became a standing ledger, which is not
    // what the button offered. Either it ends on a date or it is a group.
    if (kind === "trip" && endDate === "") return setFailure(t("ledger.endDateRequired"));

    let budget: number | null = null;
    if (kind === "trip" && budgetRaw.trim() !== "") {
      budget = rupeesToPaise(budgetRaw);
      // Integer paise or nothing - never send a half-parsed amount.
      if (budget === null || budget <= 0) {
        setFailure(t("ledger.budgetInvalid"));
        return;
      }
    }

    create.mutate(
      {
        name: name.trim(),
        endDate: kind === "trip" && endDate !== "" ? endOfLocalDay(endDate) : null,
        budget,
        cloneFrom: cloneFrom === "" ? null : cloneFrom,
        invitesEnabled,
        color,
        emoji: emoji.trim() === "" ? null : emoji.trim(),
      },
      {
        onSuccess: (ledger) => {
          onDone();
          navigate(`/ledgers/${ledger.id}`);
        },
        onError: () => setFailure(t("error.generic")),
      },
    );
  };

  return (
    // noValidate: the in-page messages below are the single mechanism. Native
    // bubbles are suppressed in some contexts, and then the button just does nothing.
    <form onSubmit={onSubmit} noValidate>
      <Field label={t("ledger.name")}>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t(`ledger.namePlaceholder.${kind}`)}
          required
          maxLength={80}
          autoFocus
        />
      </Field>

      <Field label={t("ledger.colorOptional")}>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-label={t("ledger.colorNone")}
            aria-pressed={color === null}
            onClick={() => setColor(null)}
            className={`h-7 w-7 rounded-full border-2 ${focusRing}`}
            style={{ borderColor: color === null ? "var(--ink)" : "var(--line)", background: "var(--paper-sunk)" }}
          />
          {LEDGER_COLOR_VALUES.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              aria-pressed={color === c}
              onClick={() => setColor(c)}
              className={`h-7 w-7 rounded-full border-2 ${focusRing}`}
              style={{ borderColor: color === c ? "var(--ink)" : "transparent", background: LEDGER_COLOR_SWATCH[c] }}
            />
          ))}
        </div>
      </Field>

      <Field label={t("ledger.emojiOptional")}>
        <Input
          value={emoji}
          onChange={(e) => setEmoji(e.target.value)}
          placeholder={t("ledger.emojiPlaceholder")}
          maxLength={8}
        />
      </Field>

      {kind === "trip" && (
        <>
          <Field label={t("ledger.endDate")}>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
          </Field>
          <Field label={t("ledger.budgetOptional")}>
            <Rupees value={budgetRaw} onChange={setBudgetRaw} />
          </Field>
        </>
      )}

      {cloneable.length > 0 && (
        <Field label={t("ledger.cloneFrom")}>
          <Select value={cloneFrom} onChange={(e) => setCloneFrom(e.target.value)}>
            <option value="">{t("ledger.cloneNone")}</option>
            {cloneable.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
      )}

      {/* An invite is a bearer credential, so this is a decision, not a default to
          inherit silently (ADR 0007). Same label and same on/off copy as the
          ledger's ⋯ menu - one switch, described one way. */}
      <label className="mb-1.5 flex items-center gap-2.5 text-[14px]">
        <input
          type="checkbox"
          checked={invitesEnabled}
          onChange={(e) => setInvitesEnabled(e.target.checked)}
          className={`h-4 w-4 ${focusRing}`}
          style={{ accentColor: "var(--moss)" }}
        />
        {t("ledger.invitesEnabled")}
      </label>
      <p className="mb-1.5 text-[11.5px]" style={{ color: "var(--ink-3)" }}>
        {t(invitesEnabled ? "ledger.invitesOnHint" : "ledger.invitesOffHint")}
      </p>
      <p className="mb-3 text-[11.5px]" style={{ color: "var(--ink-3)" }}>
        {t("ledger.invitesCreateHint")}
      </p>

      {/* One hint, not two saying overlapping things. */}
      <p className="mb-3 text-[11.5px]" style={{ color: "var(--ink-3)" }}>
        {t(`ledger.kindHint.${kind}`)}
      </p>

      {failure && (
        <p role="alert" className="mb-3 text-[12.5px]" style={{ color: "var(--clay)" }}>
          {failure}
        </p>
      )}

      <div className="pad-safe-bottom sticky bottom-0 -mx-4 px-4 pt-2 pb-2" style={{ background: "var(--paper)" }}>
        <Button type="submit" className="w-full" disabled={create.isPending}>
          {t("ledger.create")}
        </Button>
      </div>
    </form>
  );
}
