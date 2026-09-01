// The coin balance is DERIVED, never stored as a counter (PLAN.md's "no
// denormalized counters" rule) — it's the sum of prices already paid out on
// sold fish, plus whatever resold decor has paid back, minus the sum of
// prices ever paid for decor (a resold item's `pricePaid` still counts here —
// it's a historical fact, not undone by the resale). All three
// per-transaction numbers ARE stored (`sessions.soldPrice`,
// `decorItems.pricePaid`/`resalePrice`) because they're the recorded terms of
// a completed transaction, not a recomputable total — see `db/schema.ts`'s
// doc comments.

import type { DecorItemRow, SessionRow } from "@/db/schema";

export function coinsEarned(rows: readonly SessionRow[]): number {
  return rows.reduce((sum, row) => sum + (row.soldPrice ?? 0), 0);
}

export function coinsSpent(items: readonly DecorItemRow[]): number {
  return items.reduce((sum, item) => sum + item.pricePaid, 0);
}

export function coinsFromResale(items: readonly DecorItemRow[]): number {
  return items.reduce((sum, item) => sum + (item.resalePrice ?? 0), 0);
}

export function coinBalance(rows: readonly SessionRow[], items: readonly DecorItemRow[]): number {
  return coinsEarned(rows) + coinsFromResale(items) - coinsSpent(items);
}
