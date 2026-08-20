import { useEffect } from "react";
import { useFrameCallback, useSharedValue, type SharedValue } from "react-native-reanimated";

import { initCrawlState, stepCrawl, type CrawlState, type CrawlTrack } from "./crawl";

export type { CrawlTrack } from "./crawl";

interface Options {
  track: CrawlTrack;
  /** Stable per-individual value in [0,1) — spreads snails along the track deterministically. */
  seed: number;
  /** Multiplier on crawl speed. */
  speedFactor?: number;
  enabled: boolean;
}

export interface Crawl {
  x: SharedValue<number>;
  y: SharedValue<number>;
  /** Surface tangent, radians — the angle the art is rotated to so its sole lies on the surface. */
  angle: SharedValue<number>;
  /** +1 = facing along increasing arc length, -1 = facing back. Mirrors the sprite; never flips the surface normal (see `crawl.ts`'s header). */
  dir: SharedValue<number>;
  /** Pedal wave phase — the render layer turns this into the body's forward pulse and the tentacle sway. */
  wavePhase: SharedValue<number>;
  speedNorm: SharedValue<number>;
  elapsed: SharedValue<number>;
}

/**
 * Per-snail locomotion via `sim/crawl.ts`'s track-bound position — the
 * surface-crawler counterpart to `use-v2-swim.ts`, and deliberately NOT a
 * mode of it: a crawler has one degree of freedom (arc length) where a
 * swimmer has three, so sharing the engine would mean giving the snail the
 * ability to leave the surface and then steering it back.
 */
export function useCrawl({ track, seed, speedFactor = 1, enabled }: Options): Crawl {
  const state = useSharedValue<CrawlState>(initCrawlState(track, seed));

  const x = useSharedValue(state.value.x);
  const y = useSharedValue(state.value.y);
  const angle = useSharedValue(state.value.angle);
  const dir = useSharedValue<number>(state.value.dir);
  const wavePhase = useSharedValue(state.value.wavePhase);
  const speedNorm = useSharedValue(0);
  const elapsed = useSharedValue(0);

  const trackRef = useSharedValue(track);
  const speedFactorRef = useSharedValue(speedFactor);
  useEffect(() => {
    // Just hand over the new track: `stepCrawl` notices the length changed and
    // re-seats `s` proportionally itself, on the UI thread where the state
    // object actually lives (see `CrawlState.trackTotal`). A layout change —
    // rotation, a keyboard, a band re-measure — rebuilds the track at a
    // different length, and keeping the raw `s` would drop the snail onto a
    // different surface entirely.
    trackRef.set(track);
  }, [track, trackRef]);
  useEffect(() => {
    speedFactorRef.set(speedFactor);
  }, [speedFactor, speedFactorRef]);

  const frameCallback = useFrameCallback((info) => {
    "worklet";
    const dtMs = info.timeSincePreviousFrame;
    if (dtMs == null) return;
    const s = state.value;
    stepCrawl(s, trackRef.value, dtMs / 1000, speedFactorRef.value, Math.random);

    x.value = s.x;
    y.value = s.y;
    angle.value = s.angle;
    dir.value = s.dir;
    wavePhase.value = s.wavePhase;
    speedNorm.value = s.speedNorm;
    elapsed.value = s.elapsed;
  }, false);

  useEffect(() => {
    frameCallback.setActive(enabled && track.total > 0);
    return () => frameCallback.setActive(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, track]);

  return { x, y, angle, dir, wavePhase, speedNorm, elapsed };
}
