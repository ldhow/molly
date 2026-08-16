"use no memo"; // useDerivedValue reads a clock SharedValue — same reasoning
// as fish-layer.tsx's pragma.

import {
  Group,
  LinearGradient,
  Rect,
  Shader,
  Skia,
  useClock,
  vec,
  type Uniforms,
} from "@shopify/react-native-skia";
import { useDerivedValue } from "react-native-reanimated";

import { sandHeightFor } from "@/shared/constants/tank";
import { parseHex } from "@/shared/lib/color";

import { getWaterEffect } from "../core/sksl/water";

interface Props {
  width: number;
  height: number;
}

// Brightened toward the reference's luminous sunlit blue. The old top
// (#1c4f66) was dark enough that the god-ray shafts and the kelp
// silhouettes had nothing to read against — contrast, not ray opacity, was
// what made the light invisible. The bottom stays deliberately dark so the
// top-to-bottom depth gradient still reads.
const WATER_TOP = "#2f86ab";
const WATER_MID = "#175a78";
const WATER_BOTTOM = "#08202e";
const SUBSTRATE_TOP = "#c9b48a";
const SUBSTRATE_BOTTOM = "#8f7d5c";

function toUnit(hex: string): [number, number, number] {
  const rgb = parseHex(hex) ?? [0, 0, 0];
  return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
}

const COLOR_TOP = toUnit(WATER_TOP);
const COLOR_MID = toUnit(WATER_MID);
const COLOR_BOTTOM = toUnit(WATER_BOTTOM);

/** Depth gradient + soft caustic shimmer + drifting god rays — one fullscreen shader, no per-fish/decor cost. */
export function AquariumWater({ width, height }: Props) {
  const clock = useClock();
  const effect = getWaterEffect(Skia);

  const uniforms = useDerivedValue<Uniforms>(() => ({
    width,
    height,
    time: clock.value / 1000,
    colorTop: COLOR_TOP,
    colorMid: COLOR_MID,
    colorBottom: COLOR_BOTTOM,
  }));

  if (!effect) {
    return (
      <Rect x={0} y={0} width={width} height={height}>
        <LinearGradient
          start={vec(0, 0)}
          end={vec(0, height)}
          colors={[WATER_TOP, WATER_MID, WATER_BOTTOM]}
          positions={[0, 0.55, 1]}
        />
      </Rect>
    );
  }

  return (
    <Rect x={0} y={0} width={width} height={height}>
      <Shader source={effect} uniforms={uniforms} />
    </Rect>
  );
}

export function AquariumSubstrate({ width, height }: Props) {
  const sandHeight = sandHeightFor(height);
  const y = height - sandHeight;
  return (
    <Group>
      <Rect x={0} y={y} width={width} height={sandHeight}>
        <LinearGradient
          start={vec(0, y)}
          end={vec(0, height)}
          colors={[SUBSTRATE_TOP, SUBSTRATE_BOTTOM]}
        />
      </Rect>
    </Group>
  );
}
