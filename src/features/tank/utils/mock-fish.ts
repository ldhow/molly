// Dev-only fish generator for the animation preview screen — builds `TankFish`
// entries entirely in memory (no DB writes), using the exact same trait-roll
// and scale math a real completed session produces (see `useAddDevFishMutation`
// and `toTankFish` in `use-owned-fish.ts`), so what's on screen looks like a
// real tank, not a synthetic stand-in.
import type { TankFish } from "@/shared/components/tank/tank-canvas";
import { STAGE_SCALE, TANK_FISH_SCALE } from "@/shared/constants/tank";
import { COLOR_DEFS, patternSeedOf, rollTraits } from "@/shared/fish/catalog";
import type { LifeStage } from "@/shared/fish/types";
import { seedFromString } from "@/shared/lib/seed";

// Mostly adults (what a populated tank looks like), with a few younger fish
// so squish/scale differences are visible in the same screen.
const STAGE_MIX: LifeStage[] = ["adult", "adult", "adult", "adult", "juvenile", "fry"];

function mockFish(
  id: string,
  color: (typeof COLOR_DEFS)[number]["id"],
  stage: LifeStage,
): TankFish {
  return {
    key: id,
    traits: { ...rollTraits(color), patternSeed: patternSeedOf(id) },
    stage,
    status: "alive",
    // Same 0.85–1.15 spread `sizeForMinutes` produces, just keyed off the
    // fish's index instead of a session's planned minutes.
    scale: TANK_FISH_SCALE * STAGE_SCALE[stage] * (0.85 + ((seedFromString(id) * 37) % 1) * 0.3),
    seed: seedFromString(id),
  };
}

/** `count` live, swimming fish spanning every color and a few life stages. */
export function mockAliveFish(count: number): TankFish[] {
  return Array.from({ length: count }, (_, i) => {
    const color = COLOR_DEFS[i % COLOR_DEFS.length].id;
    const stage = STAGE_MIX[i % STAGE_MIX.length];
    return mockFish(`preview-alive-${i}-${color}`, color, stage);
  });
}

/** `count` corpses on the sand, to confirm dead rendering is unaffected. */
export function mockDeadFish(count: number): TankFish[] {
  return Array.from({ length: count }, (_, i) => {
    const color = COLOR_DEFS[(i * 5) % COLOR_DEFS.length].id;
    const fish = mockFish(`preview-dead-${i}-${color}`, color, "adult");
    return { ...fish, status: "dead" as const };
  });
}
