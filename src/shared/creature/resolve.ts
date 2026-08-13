// The ONE place a `SessionRow` gets turned into "what species, what traits."
// Every call site that reads a row's rewarded creature routes through here —
// never `traitsOfRow`/`getColorDef` directly on a raw row — because both of
// those silently fall back to a default MOLLY on an unrecognized id
// (`getColorDef`) or a legacy-variant guess (`traitsOfRow`). Left unguarded,
// an otter row would render as a Gold Dust molly with no error anywhere.

import type { SessionRow } from "@/db/schema";
import { traitsOfRow } from "@/shared/fish/catalog";
import type { FishTraits } from "@/shared/fish/types";

import { getSpeciesDef } from "./catalog";
import type { SpeciesId } from "./types";

export type ResolvedCreature =
  | { speciesId: "molly"; traits: FishTraits; variant?: undefined }
  | { speciesId: Exclude<SpeciesId, "molly">; variant: string; traits?: undefined };

/** `row.speciesId` is null on every pre-species row — those are always molly. */
export function speciesOfRow(row: SessionRow): SpeciesId {
  return (row.speciesId as SpeciesId | null) ?? "molly";
}

export function resolveCreature(row: SessionRow): ResolvedCreature {
  const speciesId = speciesOfRow(row);
  if (speciesId === "molly") {
    return { speciesId, traits: traitsOfRow(row) };
  }
  // `creatureVariant` is only ever null on a malformed row (shouldn't
  // happen once `useEndSessionMutation` always writes it for non-molly
  // species) — fall back to the species' own lowest-tier variant rather
  // than crashing a render.
  const variant = row.creatureVariant ?? getSpeciesDef(speciesId).variants[0]?.id ?? "";
  return { speciesId, variant };
}
