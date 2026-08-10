// All amounts are integer PAISE. No float anywhere. See docs/adr/0003.

export type Paise = number;

/** Divide `total` among `n` participants. Caller assigns the remainder to the payer. */
export function splitEqual(_total: Paise, _n: number): { each: Paise; remainder: Paise } {
  throw new Error("TODO");
}

/** Resolve weights to paise. Remainder is returned, not distributed. */
export function splitShares(_total: Paise, _weights: number[]): { parts: Paise[]; remainder: Paise } {
  throw new Error("TODO");
}

/** Resolve percentages (must sum to 100) to paise. */
export function splitPercent(_total: Paise, _percents: number[]): { parts: Paise[]; remainder: Paise } {
  throw new Error("TODO");
}

/** Display only. Never used for arithmetic. */
export function formatPaise(_amount: Paise): string {
  throw new Error("TODO"); // Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" })
}
