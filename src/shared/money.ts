// All amounts are integer PAISE. No float anywhere. See docs/adr/0003.

export type Paise = number;
export type SplitMode = "equal" | "exact" | "shares" | "percent";

/** ~10 billion rupees. Anything larger is a typo, not an expense. */
export const MAX_PAISE = 1e13;

const isInt = (n: unknown): n is number => Number.isInteger(n);

/** (a * b) / c, truncated toward zero, exact for any magnitude we allow. */
const mulDiv = (a: number, b: number, c: number): number => Number((BigInt(a) * BigInt(b)) / BigInt(c));

/** Resolve any split mode to exact paise per participant.
 *  participants: stable order (order of addition). payerIndex: index of payer in
 *  participants, or -1 if the payer is not a participant.
 *  Remainder goes to the payer, else to participants[0].
 *  Throws on invalid input (exact not summing to total, percents not summing to 100,
 *  non-integer paise, empty participants, non-positive weights). */
export function resolveSplits(input: {
  total: Paise;
  mode: SplitMode;
  participantCount: number;
  payerIndex: number;
  values?: number[]; // exact: paise; shares: weights; percent: percents. undefined for equal
}): Paise[] {
  const { total, mode, participantCount: n, payerIndex } = input;

  if (!isInt(total) || total === 0) throw new Error("total must be a non-zero integer number of paise");
  if (Math.abs(total) > MAX_PAISE) throw new Error("total is out of range");
  if (!isInt(n) || n < 1) throw new Error("an expense needs at least one participant");
  if (!isInt(payerIndex) || payerIndex < -1 || payerIndex >= n) throw new Error("payerIndex is out of range");

  let values: number[] = [];
  if (mode !== "equal") {
    if (!input.values || input.values.length !== n) throw new Error("one value per participant is required");
    if (!input.values.every(isInt)) throw new Error("split values must be integers");
    values = input.values;
  }

  let parts: Paise[];
  switch (mode) {
    case "equal":
      parts = Array<number>(n).fill(mulDiv(total, 1, n));
      break;
    case "exact":
      // Excluding someone is leaving them out, not giving them a zero share.
      // A resolved 0 from rounding is unavoidable; a user-entered 0 is not.
      if (values.some((v) => v === 0)) throw new Error("an exact split cannot be zero");
      if (values.reduce((a, b) => a + b, 0) !== total) throw new Error("exact splits must sum to the total");
      parts = values.slice();
      break;
    case "shares": {
      if (values.some((w) => w <= 0)) throw new Error("a share weight must be positive");
      const sum = values.reduce((a, b) => a + b, 0);
      parts = values.map((w) => mulDiv(total, w, sum));
      break;
    }
    case "percent": {
      if (values.some((p) => p <= 0)) throw new Error("a percent must be positive");
      if (values.reduce((a, b) => a + b, 0) !== 100) throw new Error("percents must sum to 100");
      parts = values.map((p) => mulDiv(total, p, 100));
      break;
    }
    default:
      throw new Error(`unknown split mode: ${String(mode)}`);
  }

  // Truncation is toward zero, so the remainder carries the sign of the total.
  const remainder = total - parts.reduce((a, b) => a + b, 0);
  const absorber = payerIndex >= 0 ? payerIndex : 0;
  parts[absorber] = parts[absorber]! + remainder;
  return parts;
}

/** Display only. Never used for arithmetic — formats the integer parts separately
 *  so no paise value ever passes through a float. */
export function formatPaise(amount: Paise): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";
  const rupees = new Intl.NumberFormat("en-IN").format(Math.floor(abs / 100));
  return `${sign}₹${rupees}.${String(abs % 100).padStart(2, "0")}`;
}
