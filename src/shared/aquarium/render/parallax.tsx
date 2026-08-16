"use no memo"; // Reads a clock SharedValue inside useDerivedValue — same
// reasoning as scene-layers.tsx's pragma.

import { Group, useClock } from "@shopify/react-native-skia";
import type { ReactNode } from "react";
import { useDerivedValue, type SharedValue } from "react-native-reanimated";

import { DEFAULT_SCENE_DESIGN } from "../scene/scene-design";

const AMPLITUDE = DEFAULT_SCENE_DESIGN.layers.parallaxAmplitude;
const PERIOD_SEC = DEFAULT_SCENE_DESIGN.layers.parallaxPeriodSec;

/**
 * A slow autonomous horizontal drift, shared by every depth band so they can
 * each apply their own fraction of it (`ParallaxGroup`'s `factor`) — no
 * camera object exists elsewhere in this renderer, this SharedValue IS the
 * camera. One clock read, reused by every band, so parallax costs one
 * `useDerivedValue` per band, not per piece.
 */
export function useCameraX(): SharedValue<number> {
  const clock = useClock();
  return useDerivedValue(
    () => Math.sin((clock.value / 1000) * ((2 * Math.PI) / PERIOD_SEC)) * AMPLITUDE,
  );
}

interface ParallaxGroupProps {
  /** This band's fraction of the shared drift — smaller for farther layers, so near/far bands shift at different rates and the scene reads as having depth. */
  factor: number;
  cameraX: SharedValue<number>;
  children: ReactNode;
}

export function ParallaxGroup({ factor, cameraX, children }: ParallaxGroupProps) {
  const transform = useDerivedValue(() => [{ translateX: -cameraX.value * factor }]);
  return <Group transform={transform}>{children}</Group>;
}
