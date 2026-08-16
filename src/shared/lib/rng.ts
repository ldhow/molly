// Seeded pseudo-random, shared so every generator that needs "random but
// stable per fish/tank" uses the same stream implementation. Dependency-free
// (render-spec.ts imports it and must run under plain Node).

import { hash32, seedFromString } from "./seed";

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

/**
 * A generator seeded from a string key, via the shared FNV-1a hash.
 *
 * `seedFromString` quantises to 1/10000, so this reaches only 10,000 distinct
 * streams — fine for its callers (placement jitter, the 8-bucket pattern
 * variant), and unchangeable regardless, since every baked pixel depends on
 * the exact streams it produces today. Use `makeRng32` for a large seed space.
 */
export function makeRng(key: string): () => number {
  return mulberry32(Math.floor(seedFromString(key) * 4294967296) || 1);
}

/**
 * Full-entropy sibling of `makeRng`: 2^32 distinct streams rather than 10,000.
 * The procedural breed generator keys off unbounded seeds, so `makeRng`'s
 * ceiling would collide it down to ~10k breeds — this doesn't.
 */
export function makeRng32(key: string): () => number {
  return mulberry32(hash32(key) || 1);
}
