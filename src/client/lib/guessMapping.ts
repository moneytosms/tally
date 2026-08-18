// Pre-fills the import mapping UI: guesses which report row belongs to which
// member. Never auto-commits - the UI stays a plain overridable dropdown, this
// only decides its default value. Threshold favors precision over recall: a
// wrong guess that goes unnoticed is worse than one more manual click.
import type { Member } from "~/client/lib/queries";

const normalize = (s: string) => s.trim().toLowerCase();

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let j = 0; j < cols; j++) d[0]![j] = j;
  for (let i = 0; i < rows; i++) d[i]![0] = i;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
    }
  }
  return d[rows - 1]![cols - 1]!;
}

/** 0..1, higher is closer. Combines edit-distance similarity with a token
 *  subset bonus, so "Bob" matches "Bob Smith" as well as a typo'd "Bobb". */
function score(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length, 1);
  const editScore = 1 - levenshtein(a, b) / maxLen;

  const aTokens = new Set(a.split(/\s+/).filter(Boolean));
  const bTokens = new Set(b.split(/\s+/).filter(Boolean));
  const isSubset = (x: Set<string>, y: Set<string>) => x.size > 0 && [...x].every((t) => y.has(t));
  const tokenScore = isSubset(aTokens, bTokens) || isSubset(bTokens, aTokens) ? 0.9 : 0;

  return Math.max(editScore, tokenScore);
}

const CONFIDENCE_THRESHOLD = 0.72;

/** Guesses a mapping from parsed report names to ledger members, fuzzy-matched
 *  against each member's nickname and (if a guest) their guest name. Names
 *  that don't clear the threshold against any member stay unmapped. */
export function guessMapping(sourceNames: string[], members: Member[]): Record<string, string> {
  const guess: Record<string, string> = {};

  for (const sourceName of sourceNames) {
    const normalizedSource = normalize(sourceName);
    let best: { memberId: string; score: number } | null = null;

    for (const member of members) {
      const candidates = [member.nickname, member.guestName].filter((n): n is string => !!n);
      for (const candidate of candidates) {
        const s = score(normalizedSource, normalize(candidate));
        if (!best || s > best.score) best = { memberId: member.id, score: s };
      }
    }

    if (best && best.score >= CONFIDENCE_THRESHOLD) guess[sourceName] = best.memberId;
  }

  return guess;
}
