import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  /**
   * Legacy pre-trait column; molly rows mirror colorId here. Non-molly rows
   * write an opaque `${speciesId}:${variant}` value purely to satisfy this
   * NOT NULL constraint — it is never read back for them (see
   * `resolveCreature()` in `@/shared/creature/resolve.ts`).
   */
  variantId: text("variant_id").notNull(),
  // Trait columns (nullable — legacy rows resolve via catalog.traitsOfRow).
  // All four are molly-specific; null on every non-molly row.
  colorId: text("color_id"),
  bodyId: text("body_id"),
  tailId: text("tail_id"),
  dorsalId: text("dorsal_id"),
  /** Which species this row grew — null means "molly" (pre-species rows). */
  speciesId: text("species_id"),
  /** This species' own rolled variant (non-molly only — molly's variant is `colorId`+bodyId+tailId+dorsalId). */
  creatureVariant: text("creature_variant"),
  plannedMinutes: integer("planned_minutes").notNull(),
  startedAt: integer("started_at").notNull(),
  endedAt: integer("ended_at").notNull(),
  outcome: text("outcome", {
    enum: ["completed", "failed", "abandoned"],
  }).notNull(),
  localDate: text("local_date").notNull(),
  /** 1 = rendered in the tank, 0 = archived to the Holding Tank. Nullable only
   *  until the backfill migration runs; treat null as 0 defensively. */
  inTank: integer("in_tank"),
  /** When this fish was sold for coins. Null = still owned. Selling is
   *  permanent, but the row is NEVER deleted — the Fishdex still counts the
   *  variant as discovered and every `lib/sessions.ts` stat is untouched. */
  soldAt: integer("sold_at"),
  /** Coins actually paid out, recorded at sale time — deliberately NOT
   *  recomputed from the current price table at read time. Same reasoning as
   *  `localDate` being computed in JS at insert: retuning the pricing table
   *  must never silently reprice history and move the user's balance. */
  soldPrice: integer("sold_price"),
});

export type SessionRow = typeof sessions.$inferSelect;
export type NewSessionRow = typeof sessions.$inferInsert;
export type SessionOutcome = SessionRow["outcome"];

/**
 * One row per owned decor object. Also the purchase LEDGER — the coin
 * balance is `Σ sessions.sold_price − Σ decor_items.price_paid`, derived on
 * read (`shared/economy/coins.ts`), never stored as a counter.
 *
 * Placement columns are null together while the item sits in the inventory,
 * unplaced. There is deliberately NO `y_lift` column: a lifted back/mid/front
 * piece hands a snail a stem whose base floats off the sand (see
 * `scene/types.ts`'s `Placement.yLift` doc) — enforced by omission here
 * rather than by a UI guard.
 */
export const decorItems = sqliteTable("decor_items", {
  id: text("id").primaryKey(),
  /** Catalogue key — also the `SCENE_SPRITES` key it draws. */
  itemId: text("item_id").notNull(),
  /** What the item actually cost at purchase time — see `soldPrice` above for why this is stored rather than recomputed. */
  pricePaid: integer("price_paid").notNull(),
  acquiredAt: integer("acquired_at").notNull(),
  /** 6 depth tiers, farthest to nearest — "far" is deliberately not an
   *  option, that band belongs to the backdrop fill, not to owned decor. */
  layer: text("layer", { enum: ["back", "backMid", "mid", "frontMid", "front", "frontMost"] }),
  xFraction: real("x_fraction"),
  scale: real("scale"),
  mirror: integer("mirror"),
  /** Draw order within a layer; lower draws first (further back). */
  sortOrder: integer("sort_order"),
  /** When this item was sold back — permanent, same "row survives, ownership
   *  doesn't" pattern as `sessions.soldAt` for fish. Null = still owned. */
  resoldAt: integer("resold_at"),
  /** What reselling it actually paid out — always less than `pricePaid` (see
   *  `shared/decor/pricing.ts`), stored rather than recomputed for the same
   *  reason `pricePaid`/`soldPrice` are: a later rate change must never
   *  silently reprice history. */
  resalePrice: integer("resale_price"),
});

export type DecorItemRow = typeof decorItems.$inferSelect;
export type NewDecorItemRow = typeof decorItems.$inferInsert;
