import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  /** Legacy pre-trait column; new rows mirror colorId here. */
  variantId: text("variant_id").notNull(),
  // Trait columns (nullable — legacy rows resolve via catalog.traitsOfRow).
  colorId: text("color_id"),
  bodyId: text("body_id"),
  tailId: text("tail_id"),
  dorsalId: text("dorsal_id"),
  plannedMinutes: integer("planned_minutes").notNull(),
  startedAt: integer("started_at").notNull(),
  endedAt: integer("ended_at").notNull(),
  outcome: text("outcome", {
    enum: ["completed", "failed", "abandoned"],
  }).notNull(),
  localDate: text("local_date").notNull(),
});

export type SessionRow = typeof sessions.$inferSelect;
export type NewSessionRow = typeof sessions.$inferInsert;
export type SessionOutcome = SessionRow["outcome"];
