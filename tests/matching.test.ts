import { describe, expect, it } from "vitest";
import { cappedPairs, matchPairs } from "@/server/engine/matching";

const u = 2500;
const base = { openLeft: 0, openRight: 0, inLeft: 0, inRight: 0, firstPairDone: false, pairBv: u, firstPairRatio: true };

describe("pair matching", () => {
  it("1:1 does not make the first pair", () => {
    const r = matchPairs({ ...base, inLeft: u, inRight: u });
    expect(r).toMatchObject({ pairs: 0, closeLeft: u, closeRight: u, firstPairDone: false });
  });

  it("2:1 makes the first pair and uses 2 left + 1 right", () => {
    const r = matchPairs({ ...base, inLeft: 2 * u, inRight: u });
    expect(r).toMatchObject({ pairs: 1, usedLeft: 2 * u, usedRight: u, closeLeft: 0, closeRight: 0, firstPairDone: true });
  });

  it("1:2 makes the first pair from the right", () => {
    const r = matchPairs({ ...base, inLeft: u, inRight: 2 * u });
    expect(r).toMatchObject({ pairs: 1, usedLeft: u, usedRight: 2 * u, firstPairDone: true });
  });

  it("after the first pair, matching is 1:1", () => {
    const r = matchPairs({ ...base, inLeft: 5 * u, inRight: 4 * u });
    // first pair 2L+1R, then min(3,3) = 3 more
    expect(r).toMatchObject({ pairs: 4, closeLeft: 0, closeRight: 0 });
  });

  it("the stronger side gives two units when both could", () => {
    const r = matchPairs({ ...base, inLeft: 2 * u, inRight: 3 * u });
    expect(r).toMatchObject({ usedRight: 3 * u, usedLeft: 2 * u, pairs: 2, closeLeft: 0, closeRight: 0 });
  });

  it("carry forward is added to today's volume", () => {
    const r = matchPairs({ ...base, firstPairDone: true, openLeft: 3 * u, openRight: 0, inRight: 2 * u });
    expect(r).toMatchObject({ pairs: 2, closeLeft: u, closeRight: 0 });
  });

  it("partial units stay as carry", () => {
    const r = matchPairs({ ...base, firstPairDone: true, inLeft: 3000, inRight: 7000 });
    expect(r).toMatchObject({ pairs: 1, closeLeft: 500, closeRight: 4500 });
  });

  it("negative volume (refund) never makes pairs", () => {
    const r = matchPairs({ ...base, firstPairDone: true, openLeft: u, inLeft: -2 * u, inRight: 3 * u });
    expect(r).toMatchObject({ pairs: 0, closeLeft: -u, closeRight: 3 * u });
  });

  it("without the ratio rule the first pair is 1:1", () => {
    const r = matchPairs({ ...base, firstPairRatio: false, inLeft: u, inRight: u });
    expect(r.pairs).toBe(1);
  });

  it("daily cap pays 10 pairs of ₹500", () => {
    expect(cappedPairs(11, 50000, 500000)).toBe(10);
    expect(cappedPairs(3, 50000, 500000)).toBe(3);
  });
});
