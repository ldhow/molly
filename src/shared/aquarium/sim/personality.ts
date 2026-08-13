// Per-fish personality: a handful of seeded traits that make swim behaviour
// read as individual fish rather than the same particle replayed at
// different phases — "avoid having all fish move in the same way."
//
// Deliberately layered ON TOP of the existing `swim-model.ts` steering
// engine (shared with the 3D renderer) rather than replacing it: these
// traits bias that engine's existing knobs (`speedFactor`, the wander box)
// instead of reimplementing steering. A full personality-driven behaviour
// engine (forage/graze/rise/startle modes, POI seeking) is future work — see
// the plan's Phase 4 for that scope; this is the safe slice of it that
// doesn't require touching the shared steering code.
//
// Dependency-free: no React/RN/Skia. Deterministic — same seed, same traits,
// always, so `scripts/verify-aquarium.ts` can assert on it directly.

import { makeRng } from "@/shared/lib/rng";

export interface Personality {
  /** [0,1]. Higher = ventures closer to the tank edges/surface, less startled by turns. */
  boldness: number;
  /** [0,1]. Higher = shorter glide/hover spells, more frequent direction changes. */
  restlessness: number;
  /** Multiplier on cruise speed, roughly [0.75, 1.35] — some fish are just faster. */
  speedFactor: number;
  /**
   * [-1, 1]. Biases which vertical band of the tank this fish prefers:
   * negative = upper water, positive = near the substrate.
   */
  depthBias: number;
}

/** Pure function of `seed` — same fish always gets the same personality. */
export function personalityFor(seed: number): Personality {
  const rng = makeRng(`personality-${seed.toFixed(6)}`);
  return {
    boldness: rng(),
    restlessness: rng(),
    speedFactor: 0.75 + rng() * 0.6,
    depthBias: rng() * 2 - 1,
  };
}

/**
 * Applies `depthBias` to a vertical wander range: shifts and slightly
 * narrows the band toward the fish's preferred depth without ever pushing
 * it outside `[minY, maxY]` or inverting the range.
 */
export function biasedDepthRange(
  minY: number,
  maxY: number,
  depthBias: number,
): { minY: number; maxY: number } {
  const span = maxY - minY;
  if (span <= 0) return { minY, maxY };
  const shift = depthBias * span * 0.18;
  const narrowedSpan = span * 0.82;
  const center = (minY + maxY) / 2 + shift;
  const half = narrowedSpan / 2;
  const lo = Math.max(minY, center - half);
  const hi = Math.min(maxY, center + half);
  return hi > lo ? { minY: lo, maxY: hi } : { minY, maxY };
}
