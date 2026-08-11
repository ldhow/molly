// The one place that decides 2D vs 3D. Every call site renders this instead
// of TankCanvas/TankCanvas3D directly, so the user's preference (set on the
// Tank screen) applies everywhere consistently without each screen needing
// to know the preference exists.
import type { ViewStyle } from "react-native";

import { useRenderModeStore } from "@/shared/store/render-mode-store";

import { TankCanvas, type TankFish } from "./tank-canvas";
import { TankCanvas3D } from "./tank-canvas-3d";

interface Props {
  fish: TankFish[];
  mode?: "tank" | "center";
  style?: ViewStyle;
}

export function TankView({ fish, mode, style }: Props) {
  const renderMode = useRenderModeStore((s) => s.renderMode);
  return renderMode === "3d" ? (
    <TankCanvas3D fish={fish} mode={mode} style={style} />
  ) : (
    <TankCanvas fish={fish} mode={mode} style={style} />
  );
}
