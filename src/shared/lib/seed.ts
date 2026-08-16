/** Raw 32-bit FNV-1a. The shared hash core — see the two wrappers below. */
function fnv1a(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Deterministic [0,1) value from a string — stable fish placement per id.
 *
 * Note the `% 10_000`: this yields only 10,000 distinct outputs, which is
 * plenty for its callers (placement jitter, 8-bucket pattern variants) but is
 * a hard ceiling on anything that needs a large seed space. Every baked pixel
 * in the app depends on this exact arithmetic, so it must never change —
 * `hash32` below is the full-entropy sibling to reach for instead.
 */
export function seedFromString(input: string): number {
  return (fnv1a(input) % 10_000) / 10_000;
}

/**
 * Full 32-bit FNV-1a — the un-truncated sibling of `seedFromString`, for
 * callers that need the whole 2^32 space rather than 10,000 buckets (the
 * procedural breed generator, `fish/generated-breed.ts`).
 */
export function hash32(input: string): number {
  return fnv1a(input);
}

/**
 * Deterministic `[0, buckets)` integer from a string — e.g. picking a fish's
 * procedural pattern variant from its (stable, unpersisted) session id, so
 * the same id always lands on the same bucket without a DB column.
 */
export function bucketFromString(input: string, buckets: number): number {
  return Math.floor(seedFromString(input) * buckets);
}
