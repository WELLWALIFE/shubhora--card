// Pure pair-matching rules for one member in one binary on one closing.
// No database access here, so every rule is covered directly by unit tests.

export type MatchInput = {
  openLeft: number;      // carry forward from the previous closing (BV)
  openRight: number;
  inLeft: number;        // new BV today (can be negative after a refund)
  inRight: number;
  firstPairDone: boolean;
  pairBv: number;        // BV per side for one pair
  firstPairRatio: boolean; // first pair needs 2:1 or 1:2
};

export type MatchResult = {
  pairs: number;
  usedLeft: number;
  usedRight: number;
  closeLeft: number;
  closeRight: number;
  firstPairDone: boolean;
};

export function matchPairs(i: MatchInput): MatchResult {
  const u = i.pairBv;
  const L = i.openLeft + i.inLeft;
  const R = i.openRight + i.inRight;
  let usedLeft = 0;
  let usedRight = 0;
  let pairs = 0;
  let first = i.firstPairDone || !i.firstPairRatio;

  if (!first) {
    // The first pair takes two units from one side and one from the other.
    // When both sides could give two, the stronger side gives two (left on a tie).
    if (L >= 2 * u && R >= u && (L >= R || R < 2 * u)) {
      usedLeft = 2 * u; usedRight = u;
    } else if (R >= 2 * u && L >= u) {
      usedRight = 2 * u; usedLeft = u;
    } else {
      return { pairs: 0, usedLeft: 0, usedRight: 0, closeLeft: L, closeRight: R, firstPairDone: false };
    }
    pairs = 1;
    first = true;
  }

  const more = Math.max(0, Math.floor(Math.min(L - usedLeft, R - usedRight) / u));
  pairs += more;
  usedLeft += more * u;
  usedRight += more * u;

  return { pairs, usedLeft, usedRight, closeLeft: L - usedLeft, closeRight: R - usedRight, firstPairDone: first };
}

/** How many of today's pairs are paid under the daily cap; the rest are flushed. */
export function cappedPairs(pairs: number, pairIncomePaise: number, dailyCapPaise: number): number {
  if (pairIncomePaise <= 0) return 0;
  return Math.min(pairs, Math.floor(dailyCapPaise / pairIncomePaise));
}

/** Percentage in basis points of an amount in paise, rounded to the nearest paisa. */
export const bp = (paise: number, basisPoints: number) => Math.round((paise * basisPoints) / 10000);
