import type { SessionOutcome } from "@/db/schema";
import type { VariantId } from "@/shared/fish/types";

export type { SessionOutcome };

/** The persisted snapshot of a running session — survives app kill. */
export interface ActiveSession {
  id: string;
  variantId: VariantId;
  plannedMinutes: number;
  /** epoch ms */
  startedAt: number;
  /** epoch ms of the moment the app left the foreground, null while active. */
  backgroundedAt: number | null;
}

/** In-memory record of the last finished session, shown on the result sheet. */
export interface SessionResult {
  variantId: VariantId;
  plannedMinutes: number;
  outcome: SessionOutcome;
  endedAt: number;
}

export type ForegroundJudgment =
  { kind: "continue"; clearBackgrounded: boolean } | { kind: "completed" } | { kind: "failed" };
