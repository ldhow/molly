// Seeded pseudo-random, shared so every generator that needs "random but
// stable per fish/tank" uses the same stream implementation. Dependency-free
// (render-spec.ts imports it and must run under plain Node).

import { seedFromString } from "./seed";

/**
 * mulberry32 — small, fast, good enough for art placement. Returns a fresh
 * generator; the same `seed` always yields the same sequence.
 */
export function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A generator seeded from a string key, via the shared FNV-1a hash. */
export function makeRng(key: string): () => number {
  return mulberry32(Math.floor(seedFromString(key) * 4294967296) || 1);
}
