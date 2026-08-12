// Parses a free-text expense line to PREFILL the structured form. Never a trust
// boundary: anything ambiguous is left unset for the human to fill in.
import { MAX_PAISE } from "./money";

export type NlMember = { id: string; name: string };

export type NlParse = {
  /** integer paise, or null when no usable amount was found */
  total: number | null;
  /** cleaned leftover text, "" when nothing remains */
  description: string;
  /** member ids, in the order they appeared in the input (stable order matters -
   *  the remainder rule depends on it) */
  participantIds: string[];
  /** member id of an explicit "paid by X", else null */
  payerId: string | null;
  /** name-like tokens that matched no member, so the UI can say so */
  unmatched: string[];
};

// ₹450, Rs 450, rs.450, 1,250, 1.2k, 450.50 - captures the numeric part only.
const AMOUNT_RE = /(?:₹|rs\.?\s*)?(\d[\d,]*(?:\.\d+)?)\s*(k)?/i;

/** Parses a rupee amount string (digits, commas, optional decimal, optional "k")
 *  into integer paise using string/integer arithmetic - never parseFloat. */
function parseAmountToPaise(raw: string, hasK: boolean): number | null {
  const clean = raw.replace(/,/g, "");
  const [rupeeStr, paiseStr = ""] = clean.split(".");
  if (paiseStr.length > 2) return null; // more than 2 decimals: reject, never silently round
  if (!rupeeStr) return null;
  const rupees = BigInt(rupeeStr);
  const paiseFrac = BigInt(paiseStr.padEnd(2, "0") || "0");
  let paise = rupees * 100n + paiseFrac;
  if (hasK) paise *= 1000n;
  if (paise > BigInt(MAX_PAISE) || paise <= 0n) return null;
  return Number(paise);
}

function findAmount(input: string): { total: number | null; matchText: string; index: number } {
  const m = AMOUNT_RE.exec(input);
  if (!m || !m[1]) return { total: null, matchText: "", index: -1 };
  const total = parseAmountToPaise(m[1], !!m[2]);
  return { total, matchText: m[0], index: m.index };
}

/** True if candidate is a prefix of full (case-insensitive), at least 3 chars. */
function isPrefixMatch(token: string, full: string): boolean {
  return token.length >= 3 && full.toLowerCase().startsWith(token.toLowerCase());
}

export function parseExpenseLine(input: string, members: NlMember[]): NlParse {
  const result: NlParse = { total: null, description: "", participantIds: [], payerId: null, unmatched: [] };
  if (typeof input !== "string") return result;
  const text = input.trim();
  if (text === "") return result;

  const { total, matchText, index } = findAmount(text);
  result.total = total;

  // Remove the amount text from the working copy so its digits don't get
  // mistaken for a name token later.
  let working = index >= 0 ? text.slice(0, index) + " " + text.slice(index + matchText.length) : text;

  // "paid by <name>" / "<name> paid"
  let payerName: string | null = null;
  const paidByMatch = /\bpaid\s+by\s+([a-z][a-z'-]*)/i.exec(working);
  if (paidByMatch && paidByMatch[1]) {
    payerName = paidByMatch[1];
    working = working.slice(0, paidByMatch.index) + " " + working.slice(paidByMatch.index + paidByMatch[0].length);
  } else {
    const namePaidMatch = /\b([a-z][a-z'-]*)\s+paid\b/i.exec(working);
    if (namePaidMatch && namePaidMatch[1]) {
      payerName = namePaidMatch[1];
      working =
        working.slice(0, namePaidMatch.index) + " " + working.slice(namePaidMatch.index + namePaidMatch[0].length);
    }
  }

  const matchName = (token: string): NlMember | "ambiguous" | null => {
    const lower = token.toLowerCase();
    const exact = members.find((m) => m.name.toLowerCase() === lower);
    if (exact) return exact;
    const firstNameMatches = members.filter((m) => m.name.split(" ")[0]!.toLowerCase() === lower);
    if (firstNameMatches.length === 1) return firstNameMatches[0]!;
    if (firstNameMatches.length > 1) return "ambiguous";
    const prefixMatches = members.filter((m) => isPrefixMatch(token, m.name));
    if (prefixMatches.length === 1) return prefixMatches[0]!;
    if (prefixMatches.length > 1) return "ambiguous";
    return null;
  };

  if (payerName) {
    const m = matchName(payerName);
    if (m && m !== "ambiguous") result.payerId = m.id;
  }

  // Tokenize on whitespace, keeping punctuation attached, so "," / "&" and
  // trailing commas can signal "a name goes here" (connector context). A bare
  // word that matches no member (e.g. "dinner") is just left in the
  // description; a word in connector context that matches no member (e.g.
  // "with zoya") is reported as unmatched - that distinction is the point.
  const rawTokens = working.split(/\s+/).filter(Boolean);
  const seen = new Set<string>();
  const consumedTokens = new Set<string>(); // lowercase tokens consumed as names/connectors
  let expectName = false;

  for (const raw of rawTokens) {
    if (raw === "," || raw === "&") {
      expectName = true;
      continue;
    }
    const trailingComma = raw.endsWith(",");
    const core = raw.replace(/^[,&]+|[,&]+$/g, "");
    if (core === "") {
      if (trailingComma) expectName = true;
      continue;
    }
    const lower = core.toLowerCase();
    if (lower === "with" || lower === "and") {
      expectName = true;
      consumedTokens.add(lower);
      continue;
    }

    const m = matchName(core);
    if (m === "ambiguous") {
      // Ambiguous is always reported, connector context or not.
      result.unmatched.push(core);
      consumedTokens.add(lower);
    } else if (m) {
      if (!seen.has(m.id)) {
        seen.add(m.id);
        result.participantIds.push(m.id);
      }
      consumedTokens.add(lower);
    } else if (expectName) {
      result.unmatched.push(core);
      consumedTokens.add(lower);
    }
    expectName = trailingComma;
  }

  // Description: leftover words, excluding amount, connectors, matched/unmatched
  // name tokens, and the payer name.
  const excluded = new Set(consumedTokens);
  if (payerName) excluded.add(payerName.toLowerCase());
  const descTokens = working
    .split(/\s+/)
    .map((t) => t.replace(/^[,&]+|[,&]+$/g, ""))
    .filter((t) => t !== "" && !excluded.has(t.toLowerCase()));
  result.description = descTokens.join(" ").trim();

  return result;
}
