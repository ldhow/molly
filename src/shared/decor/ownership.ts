import type { DecorItemRow } from "@/db/schema";

/** A resold item is gone — same "row survives, ownership doesn't" pattern as
 *  `shared/lib/tank-membership.ts`'s `isSold` for fish. */
export function isOwnedDecor(row: DecorItemRow): boolean {
  return row.resoldAt === null;
}
