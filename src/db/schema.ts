import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
});

export type SessionRow = typeof sessions.$inferSelect;
export type NewSessionRow = typeof sessions.$inferInsert;
export type SessionOutcome = SessionRow["outcome"];
