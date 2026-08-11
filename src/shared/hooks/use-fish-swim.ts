import { useEffect } from "react";
import {
  Easing,
  useFrameCallback,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import { initSwimState, stepSwim, type SwimState, type WanderBox } from "@/shared/lib/swim-model";

export type { WanderBox } from "@/shared/lib/swim-model";

interface Options {
  box: WanderBox;
  /** Stable per-fish value in [0,1) — spreads fish out deterministically. */
  seed: number;
  /** Multiplier on swim speed (session fish drift slower). */
  speedFactor?: number;
  enabled: boolean;
}

export interface FishSwim {
  x: SharedValue<number>;
  y: SharedValue<number>;
  tilt: SharedValue<number>;
  /** Roll into the turn, radians. */
  bank: SharedValue<number>;
  /** 0 = facing left (sprite default), π = facing right — a `rotateY` sweep. */
  yaw: SharedValue<number>;
  /** Current speed relative to cruise baseline, roughly [0, 1.3]. */
  speedNorm: SharedValue<number>;
  /** Monotonically increasing phase driving tail/body beat. */
  beatPhase: SharedValue<number>;
}

/**
 * Per-fish locomotion: a continuously-steered particle (see `swim-model.ts`)
 * integrated once per frame on the UI thread. Replaces the old hop-to-a-point
 * wander with curved, never-fully-stopping motion and turns that yaw through
 * depth instead of mirror-flipping.
 */
export function useFishSwim({ box, seed, speedFactor = 1, enabled }: Options): FishSwim {
  const state = useSharedValue<SwimState>(initSwimState(box, seed));
  const seedPhase = seed * Math.PI * 2;

  const x = useSharedValue(state.value.x);
  const y = useSharedValue(state.value.y);
  const tilt = useSharedValue(0);
  const bank = useSharedValue(0);
  const yaw = useSharedValue(state.value.facingRight ? 0 : Math.PI);
  const speedNorm = useSharedValue(0);
  const beatPhase = useSharedValue(state.value.beatPhase);

  const boxRef = useSharedValue(box);
  boxRef.value = box;
  const speedFactorRef = useSharedValue(speedFactor);
  speedFactorRef.value = speedFactor;

  const frameCallback = useFrameCallback((info) => {
    "worklet";
    const dtMs = info.timeSincePreviousFrame;
    if (dtMs == null) return;
    const s = state.value;
    const wasFacingRight = s.facingRight;
    stepSwim(s, boxRef.value, dtMs / 1000, speedFactorRef.value, seedPhase, Math.random);

    x.value = s.x;
    y.value = s.y;
    tilt.value = s.tilt;
    const f = s.facingRight ? 1 : -1;
    bank.value = Math.max(-0.15, Math.min(0.15, -f * s.turnRate * 0.12));
    speedNorm.value = s.speedNorm;
    beatPhase.value = s.beatPhase;

    if (s.facingRight !== wasFacingRight) {
      yaw.value = withTiming(s.facingRight ? Math.PI : 0, {
        duration: 420,
        easing: Easing.inOut(Easing.cubic),
      });
    }
  }, false);

  useEffect(() => {
    frameCallback.setActive(enabled && box.maxX > box.minX);
    return () => frameCallback.setActive(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, box.minX, box.maxX, box.minY, box.maxY]);

  return { x, y, tilt, bank, yaw, speedNorm, beatPhase };
}
