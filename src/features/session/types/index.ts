import type { SessionOutcome } from "@/db/schema";
import type { SpeciesId } from "@/shared/creature/types";
import type { ColorId, FishTraits } from "@/shared/fish/types";

export type { SessionOutcome };

interface ActiveSessionBase {
  id: string;
  plannedMinutes: number;
  /** epoch ms */
  startedAt: number;
  /** epoch ms of the moment the app left the foreground, null while active. */
  backgroundedAt: number | null;
}

/** Chosen color. Body/tail/dorsal are rolled only at completion. */
export interface MollyActiveSession extends ActiveSessionBase {
  speciesId: "molly";
  colorId: ColorId;
}

/**
 * Chosen species — that's the whole pre-session choice for a non-molly
 * creature. Its variant is rolled only at completion (mirrors molly's
 * body/tail/dorsal, not molly's colorId: there's no per-variant picker,
 * only a per-SPECIES one — see `catalog.ts`'s "never individually locked"
 * rule).
 */
export interface CreatureActiveSession extends ActiveSessionBase {
  speciesId: Exclude<SpeciesId, "molly">;
}

/** The persisted snapshot of a running session — survives app kill. */
export type ActiveSession = MollyActiveSession | CreatureActiveSession;

/** What the user picked before starting — the input to `session-store.ts`'s `start()`. */
export type CreatureSelection =
  { speciesId: "molly"; colorId: ColorId } | { speciesId: Exclude<SpeciesId, "molly"> };

/** What got rolled at completion — the input to `session-store.ts`'s `finish()`. Molly carries both `colorId` (the pre-roll choice) and `traits` (the post-roll reveal); a creature's `variant` IS the whole roll. */
export type RolledCreature =
  | { speciesId: "molly"; colorId: ColorId; traits: FishTraits }
  | { speciesId: Exclude<SpeciesId, "molly">; variant: string };

interface SessionResultBase {
  plannedMinutes: number;
  outcome: SessionOutcome;
  endedAt: number;
}

export interface MollySessionResult extends SessionResultBase {
  speciesId: "molly";
  colorId: ColorId;
  /** Rolled at completion (all-standard for failed/abandoned sessions). */
  traits: FishTraits;
}

export interface CreatureSessionResult extends SessionResultBase {
  speciesId: Exclude<SpeciesId, "molly">;
  /** Rolled at completion (the species' own lowest-tier variant for failed/abandoned sessions). */
  variant: string;
}

/** In-memory record of the last finished session, shown on the result sheet. */
export type SessionResult = MollySessionResult | CreatureSessionResult;

export type ForegroundJudgment =
  { kind: "continue"; clearBackgrounded: boolean } | { kind: "completed" } | { kind: "failed" };
