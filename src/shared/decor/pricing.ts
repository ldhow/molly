/**
 * What reselling an owned decor item gives back — always less than
 * `pricePaid`, so buy-then-resell can never mint free coins. A flat rate
 * (not tier/rarity-based like fish pricing) because decor has no "roll" to
 * reward — the price you paid already reflects its rarity.
 */
export const DECOR_RESELL_RATE = 0.5;

export function decorResellPriceOf(pricePaid: number): number {
  return Math.max(1, Math.round(pricePaid * DECOR_RESELL_RATE));
}
