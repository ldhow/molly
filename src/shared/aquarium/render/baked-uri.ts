// Turns a baked `SkImage` into a data URI an ordinary `<Image>` can show, so
// a STATIC preview tile costs a normal composited view instead of a Skia
// `<Canvas>`.
//
// Why this exists: a `<Canvas>` from @shopify/react-native-skia is, on
// Android, a non-flattenable native view that acquires and releases its own
// EGL window surface on mount/unmount. That is the right price for the
// animated tank — one Canvas, many fish inside it — and the wrong price for a
// grid of dozens of motionless thumbnails, where it makes opening the screen
// (and any reflow of it) serialize that much native work on the main thread.
// The art is already rasterised to an `SkImage` by `core/bake.ts`; encoding
// those bytes once and handing them to the platform's own image pipeline
// removes the surface from the tile entirely.
//
// `render/fish-layer.tsx` and `render/creature-layer.tsx` are unaffected —
// they draw inside the tank's single real Canvas, which is exactly where a
// Canvas earns its cost.

import type { BakedArt } from "../core/bake";

export interface BakedImageSource {
  uri: string;
  /** width / height of the baked art — lets a caller size its tile before the image decodes. */
  aspect: number;
}

/**
 * Bounded, because the set of distinct previews is not: the Fishdex alone is
 * 18 colours, and `gen:<seed>` breeds are procedural (~480 trait combinations
 * before generated colours). Insertion-ordered `Map`, so deleting the first
 * key is a plain FIFO eviction — deliberately simpler than the byte-budgeted
 * LRU in `core/bake.ts`, since these strings are small and roughly uniform in
 * size next to the raw textures they encode.
 */
const MAX_ENTRIES = 192;
const cache = new Map<string, BakedImageSource>();

/**
 * Cache read with NO work behind it — never bakes, never encodes. This is
 * what a preview component may call during render; producing a missing entry
 * is expensive enough (rasterise ~100 nodes, then PNG-encode the result) that
 * it has to be scheduled off the render path instead. See
 * `use-baked-source.ts`.
 */
export function peekBakedSource(key: string): BakedImageSource | null {
  return cache.get(key) ?? null;
}

/**
 * `key` must identify the bake completely (art identity AND dpr) and be
 * namespaced by art kind — fish, silhouette and creature bake keys are drawn
 * from separate vocabularies and share this one cache.
 */
export function bakedImageSource(key: string, baked: BakedArt): BakedImageSource | null {
  const hit = cache.get(key);
  if (hit) return hit;
  // PNG (`encodeToBase64`'s default) and not JPEG: this art is alpha-cut
  // against whatever the tile's background is, and JPEG has no alpha channel.
  const base64 = baked.image.encodeToBase64();
  if (!base64) return null;
  const source: BakedImageSource = {
    uri: `data:image/png;base64,${base64}`,
    aspect: baked.bounds.width / Math.max(1e-6, baked.bounds.height),
  };
  cache.set(key, source);
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  return source;
}
