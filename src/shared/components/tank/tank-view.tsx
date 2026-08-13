// The one place that decides 2D vs aquarium vs 3D. Every call site renders
// this instead of TankCanvas/AquariumCanvas/TankCanvas3D directly, so the
// user's preference (set on the Tank screen) applies everywhere consistently
// without each screen needing to know the preference exists.
//
// Non-molly creatures render correctly ONLY in 2D V2 (the legacy 2D and 3D
// renderers have no otter/turtle/frog/axolotl/snail art) — a `MollyTankFish[]`
// is structurally a `TankFish[]` (see `@/shared/lib/tank-fish.ts`'s header),
// so filtering to molly-only here is enough to keep those two renderers
// completely unmodified: no crash, no wrong art, just "your otter isn't
// visible if you've switched away from 2D V2." Revisit only once 2D V2 is
// the shipped default.
import type { ViewStyle } from "react-native";

import { AquariumCanvas } from "@/shared/aquarium";
import { isMollyTankFish, type AnyTankFish } from "@/shared/lib/tank-fish";
import { useRenderModeStore } from "@/shared/store/render-mode-store";

import { TankCanvas } from "./tank-canvas";
import { TankCanvas3D } from "./tank-canvas-3d";

interface Props {
  fish: AnyTankFish[];
  mode?: "tank" | "center";
  style?: ViewStyle;
}

export function TankView({ fish, mode, style }: Props) {
  const renderMode = useRenderModeStore((s) => s.renderMode);
  if (renderMode === "v2") return <AquariumCanvas fish={fish} mode={mode} style={style} />;
  const mollyFish = fish.filter(isMollyTankFish);
  if (renderMode === "3d") return <TankCanvas3D fish={mollyFish} mode={mode} style={style} />;
  return <TankCanvas fish={mollyFish} mode={mode} style={style} />;
}
