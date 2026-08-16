// The one place that decides 2D V2 vs 3D. Every call site renders this
// instead of AquariumCanvas/TankCanvas3D directly, so the user's preference
// (set on the Tank screen) applies everywhere consistently without each
// screen needing to know the preference exists.
//
// Non-molly creatures render correctly ONLY in 2D V2 (3D has no
// otter/turtle/frog/axolotl/snail art) — a `MollyTankFish[]` is structurally
// a valid subset of `AnyTankFish[]` (see `@/shared/lib/tank-fish.ts`'s
// header), so filtering to molly-only here is enough to keep 3D completely
// unmodified: no crash, no wrong art, just "your otter isn't visible if
// you've switched to 3D."
import type { ViewStyle } from "react-native";

import { AquariumCanvas } from "@/shared/aquarium";
import { isMollyTankFish, type AnyTankFish } from "@/shared/lib/tank-fish";
import { useRenderModeStore } from "@/shared/store/render-mode-store";

import { TankCanvas3D } from "./tank-canvas-3d";

interface Props {
  fish: AnyTankFish[];
  mode?: "tank" | "center";
  style?: ViewStyle;
  /** 2D-only — forwarded to `AquariumCanvas`. Ignored by the 3D renderer, which always draws its own full scene. */
  background?: "full" | "plain";
  /** 2D-only — forwarded to `AquariumCanvas`. */
  shrinkToTankScale?: boolean;
}

export function TankView({ fish, mode, style, background, shrinkToTankScale }: Props) {
  const renderMode = useRenderModeStore((s) => s.renderMode);
  if (renderMode === "3d") {
    return <TankCanvas3D fish={fish.filter(isMollyTankFish)} mode={mode} style={style} />;
  }
  return (
    <AquariumCanvas
      fish={fish}
      mode={mode}
      style={style}
      background={background}
      shrinkToTankScale={shrinkToTankScale}
    />
  );
}
