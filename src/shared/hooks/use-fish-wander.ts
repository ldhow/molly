import { useEffect } from "react";
import { cancelAnimation, Easing, useSharedValue, withTiming } from "react-native-reanimated";

import { SWIM_SPEED } from "@/shared/constants/tank";

export interface WanderBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface Options {
  box: WanderBox;
  /** Stable per-fish value in [0,1) — spreads fish out deterministically. */
  seed: number;
  /** Multiplier on swim speed (session fish drift slower). */
  speedFactor?: number;
  enabled: boolean;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Per-fish wander behavior: pick a random target inside the box, glide to it
 * over a distance-proportional duration, pause, repeat. Returns shared values
 * consumed by the Skia transform — all motion runs on the UI thread.
 */
export function useFishWander({ box, seed, speedFactor = 1, enabled }: Options) {
  const x = useSharedValue(lerp(box.minX, box.maxX, seed));
  const y = useSharedValue(lerp(box.minY, box.maxY, (seed * 7.13) % 1));
  /** scaleX sign: 1 = facing left (sprite default), -1 = facing right. */
  const heading = useSharedValue(seed > 0.5 ? 1 : -1);
  const tilt = useSharedValue(0);

  useEffect(() => {
    if (!enabled || box.maxX <= box.minX) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const hop = () => {
      if (cancelled) return;
      const targetX = lerp(box.minX, box.maxX, Math.random());
      const targetY = lerp(box.minY, box.maxY, Math.random());
      const dx = targetX - x.value;
      const dy = targetY - y.value;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const duration = Math.max(1400, (distance / (SWIM_SPEED * speedFactor)) * 1000);

      heading.value = withTiming(dx > 0 ? -1 : 1, { duration: 320 });
      tilt.value = withTiming(Math.max(-0.4, Math.min(0.4, (dy / distance) * 0.5)), {
        duration: 500,
      });
      const easing = Easing.inOut(Easing.quad);
      x.value = withTiming(targetX, { duration, easing });
      y.value = withTiming(targetY, { duration, easing }, () => {
        tilt.value = withTiming(0, { duration: 600 });
      });

      timer = setTimeout(hop, duration + 600 + Math.random() * 3200);
    };

    hop();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      cancelAnimation(x);
      cancelAnimation(y);
      cancelAnimation(heading);
      cancelAnimation(tilt);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, box.minX, box.maxX, box.minY, box.maxY, speedFactor]);

  return { x, y, heading, tilt };
}
