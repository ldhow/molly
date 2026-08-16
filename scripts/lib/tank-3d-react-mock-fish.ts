import { TANK_FISH_SCALE, STAGE_SCALE } from "@/shared/constants/tank";
import { COLOR_DEFS, patternSeedOf, rollTraits } from "@/shared/fish/catalog";
import type { LifeStage } from "@/shared/fish/types";
import { seedFromString } from "@/shared/lib/seed";
import type { MollyTankFish } from "@/shared/lib/tank-fish";

function fish(
  id: string,
  color: (typeof COLOR_DEFS)[number]["id"],
  stage: LifeStage,
  status: "alive" | "dead" = "alive",
): MollyTankFish {
  return {
    key: id,
    speciesId: "molly",
    traits: { ...rollTraits(color), patternSeed: patternSeedOf(id) },
    stage,
    status,
    scale: TANK_FISH_SCALE * STAGE_SCALE[stage],
    seed: seedFromString(id),
  };
}

export const SCENARIOS: Record<string, MollyTankFish[]> = {
  "life-stages": [
    fish("stage-egg", "black", "egg"),
    fish("stage-fry", "gold", "fry"),
    fish("stage-juvenile", "platinum", "juvenile"),
    fish("stage-adult", "sunkiss", "adult"),
  ],
  "all-colors": COLOR_DEFS.map((c) => fish(`color-${c.id}`, c.id, "adult")),
  "alive-and-dead": [
    fish("alive-1", "electricBlue", "adult"),
    fish("alive-2", "sakura", "adult"),
    { ...fish("dead-1", "chocolate", "adult"), status: "dead" as const },
    { ...fish("dead-2", "zebra", "adult"), status: "dead" as const },
  ],
  "populated-tank": Array.from({ length: 15 }, (_, i) =>
    fish(
      `tank-${i}`,
      COLOR_DEFS[i % COLOR_DEFS.length].id,
      (["adult", "adult", "adult", "juvenile", "fry"] as const)[i % 5],
    ),
  ),
};
