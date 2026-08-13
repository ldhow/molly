import { useEffect } from "react";
import { useFrameCallback, useSharedValue, type SharedValue } from "react-native-reanimated";

import { initV2SwimState, stepV2Swim, type V2SwimState, type V2WanderBox } from "./swim";

export type { V2WanderBox } from "./swim";

interface Options {
  box: V2WanderBox;
  /** Stable per-fish value in [0,1) — spreads fish out deterministically. */
  seed: number;
  /** Multiplier on swim speed (session fish drift slower). */
  speedFactor?: number;
  /** How strongly the shared tank current nudges heading (0 = off, the default) — see `swim.ts`'s `CURRENT_FREQ`. */
  currentStrength?: number;
  enabled: boolean;
}

export interface V2Swim {
  x: SharedValue<number>;
  y: SharedValue<number>;
  /** Depth steering value only — NOT drawn directly; see fish-layer.tsx. */
  z: SharedValue<number>;
  /** Heading in the (x,z) plane, radians — 0 = facing +x, π = facing -x, ±π/2 = edge-on. */
  yaw: SharedValue<number>;
  pitch: SharedValue<number>;
  /** Longitudinal roll into the turn — NOT the old model's screen-space "bank". */
  roll: SharedValue<number>;
  speedNorm: SharedValue<number>;
  beatPhase: SharedValue<number>;
}

/**
 * Per-fish locomotion via `sim/swim.ts`'s continuously-steered (x,z,y)
 * particle — see that file's header for why this replaces
 * `@/shared/hooks/use-fish-swim.ts` for 2D V2 specifically (a fish that
 * turns by moving through depth, never by a timed mirror flip).
 */
export function useV2Swim({
  box,
  seed,
  speedFactor = 1,
  currentStrength = 0,
  enabled,
}: Options): V2Swim {
  const state = useSharedValue<V2SwimState>(initV2SwimState(box, seed));
  const seedPhase = seed * Math.PI * 2;

  const x = useSharedValue(state.value.x);
  const y = useSharedValue(state.value.y);
  const z = useSharedValue(state.value.z);
  const yaw = useSharedValue(state.value.yaw);
  const pitch = useSharedValue(0);
  const roll = useSharedValue(0);
  const speedNorm = useSharedValue(0);
  const beatPhase = useSharedValue(state.value.beatPhase);

  const boxRef = useSharedValue(box);
  const speedFactorRef = useSharedValue(speedFactor);
  const currentStrengthRef = useSharedValue(currentStrength);
  useEffect(() => {
    boxRef.set(box);
  }, [box, boxRef]);
  useEffect(() => {
    speedFactorRef.set(speedFactor);
  }, [speedFactor, speedFactorRef]);
  useEffect(() => {
    currentStrengthRef.set(currentStrength);
  }, [currentStrength, currentStrengthRef]);

  const frameCallback = useFrameCallback((info) => {
    "worklet";
    const dtMs = info.timeSincePreviousFrame;
    if (dtMs == null) return;
    const s = state.value;
    stepV2Swim(
      s,
      boxRef.value,
      dtMs / 1000,
      speedFactorRef.value,
      seedPhase,
      Math.random,
      currentStrengthRef.value,
    );

    x.value = s.x;
    y.value = s.y;
    z.value = s.z;
    yaw.value = s.yaw;
    pitch.value = s.pitch;
    roll.value = s.roll;
    speedNorm.value = s.speedNorm;
    beatPhase.value = s.beatPhase;
  }, false);

  useEffect(() => {
    frameCallback.setActive(enabled && box.maxX > box.minX);
    return () => frameCallback.setActive(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, box.minX, box.maxX, box.minY, box.maxY]);

  return { x, y, z, yaw, pitch, roll, speedNorm, beatPhase };
}
