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

import { getSubstrateEffect } from "../core/sksl/substrate";
import { getWaterEffect } from "../core/sksl/water";
import { DEFAULT_SCENE_DESIGN } from "../scene/scene-design";

interface Props {
  width: number;
  height: number;
}

// See `SceneDesign.water`'s doc comment in scene-design.ts for why the top
// stop is brightened relative to a flatter reference blue.
const WATER_TOP = DEFAULT_SCENE_DESIGN.water.top;
const WATER_MID = DEFAULT_SCENE_DESIGN.water.mid;
const WATER_BOTTOM = DEFAULT_SCENE_DESIGN.water.bottom;
const SUBSTRATE_TOP = DEFAULT_SCENE_DESIGN.substrate.top;
const SUBSTRATE_BOTTOM = DEFAULT_SCENE_DESIGN.substrate.bottom;
const SUBSTRATE_SPECKLE = DEFAULT_SCENE_DESIGN.substrate.speckleColor;
const SUBSTRATE_GRAIN_STRENGTH = DEFAULT_SCENE_DESIGN.substrate.grainStrength;
const SUBSTRATE_SPECKLE_DENSITY = DEFAULT_SCENE_DESIGN.substrate.speckleDensity;

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

const SUBSTRATE_COLOR_TOP = toUnit(SUBSTRATE_TOP);
const SUBSTRATE_COLOR_BOTTOM = toUnit(SUBSTRATE_BOTTOM);
const SUBSTRATE_COLOR_SPECKLE = toUnit(SUBSTRATE_SPECKLE);

// Wider than the canvas on both edges so the parallax camera (up to
// `parallaxAmplitude * parallaxFront` px, see `render/parallax.tsx`) never
// pans past the sand into empty canvas at either side.
const OVERSCAN = 20;

export function AquariumSubstrate({ width, height }: Props) {
  const sandHeight = sandHeightFor(height);
  const y = height - sandHeight;
  const effect = getSubstrateEffect(Skia);
  const overscanWidth = width + OVERSCAN * 2;

  const uniforms = useDerivedValue<Uniforms>(() => ({
    width: overscanWidth,
    height: sandHeight,
    colorTop: SUBSTRATE_COLOR_TOP,
    colorBottom: SUBSTRATE_COLOR_BOTTOM,
    speckleColor: SUBSTRATE_COLOR_SPECKLE,
    grainStrength: SUBSTRATE_GRAIN_STRENGTH,
    speckleDensity: SUBSTRATE_SPECKLE_DENSITY,
  }));

  if (!effect) {
    return (
      <Group>
        <Rect x={-OVERSCAN} y={y} width={overscanWidth} height={sandHeight}>
          <LinearGradient
            start={vec(0, y)}
            end={vec(0, height)}
            colors={[SUBSTRATE_TOP, SUBSTRATE_BOTTOM]}
          />
        </Rect>
      </Group>
    );
  }

  return (
    <Group transform={[{ translateY: y }]}>
      <Rect x={-OVERSCAN} y={0} width={overscanWidth} height={sandHeight}>
        <Shader source={effect} uniforms={uniforms} />
      </Rect>
    </Group>
  );
}
