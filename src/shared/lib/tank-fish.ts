// What's in the tank — one molly-typed shape, one creature-typed shape,
// discriminated on `speciesId` (a literal type, so `f.speciesId === "molly"`
// narrows automatically, no extra tag field needed).
//
// `MollyTankFish` carries every field `@/shared/components/tank/tank-canvas.tsx`'s
// `TankFish` always has, PLUS the `speciesId: "molly"` literal — so a
// `MollyTankFish[]` is structurally assignable anywhere a `TankFish[]` is
// expected (TS's excess-property check only fires on object LITERALS, not on
// values of a wider type), which is what lets the legacy 2D and 3D renderers'
// existing `TankFish`-typed props keep working completely unchanged after a
// molly-only filter — see `tank-view.tsx`.

import type { FishTraits, LifeStage } from "@/shared/fish/types";
import type { SpeciesId } from "@/shared/creature/types";

interface TankFishBase {
  key: string;
  stage: LifeStage;
  status: "alive" | "dead";
  scale: number;
  seed: number;
}

export interface MollyTankFish extends TankFishBase {
  speciesId: "molly";
  traits: FishTraits;
}

export interface CreatureTankFish extends TankFishBase {
  speciesId: Exclude<SpeciesId, "molly">;
  variant: string;
}

export type AnyTankFish = MollyTankFish | CreatureTankFish;

export function isMollyTankFish(fish: AnyTankFish): fish is MollyTankFish {
  return fish.speciesId === "molly";
}
