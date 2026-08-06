/** Deterministic [0,1) value from a string — stable fish placement per id. */
export function seedFromString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10_000) / 10_000;
}

/**
 * Deterministic `[0, buckets)` integer from a string — e.g. picking a fish's
 * procedural pattern variant from its (stable, unpersisted) session id, so
 * the same id always lands on the same bucket without a DB column.
 */
export function bucketFromString(input: string, buckets: number): number {
  return Math.floor(seedFromString(input) * buckets);
}
