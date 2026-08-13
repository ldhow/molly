// Bakes IR into a flat raster `SkImage`, plus a byte-budgeted LRU so repeated
// (traits, stage) combinations reuse one texture instead of redrawing ~100
// nodes per fish per frame. Same trick as `fish-picture.ts`, generalised to
// one caller-supplied cache per art kind (fish body, scene layers, ...)
// instead of one bespoke cache per file.
//
// Deliberately ONE layer per bake (the old pipeline baked body/tail/front as
// three separate images). This renderer keeps the tail rigid-attached in the
// warp/rigid fish layer instead of animating it as a second baked image, so
// there is only ever one texture per fish — see render/fish-layer.tsx.

import type { SkImage } from "@shopify/react-native-skia/src/skia/types";

import { emit, type PathCache } from "./emit";
import type { Box, Node } from "./ir";
import type { SkiaApi } from "./skia-types";

export interface BakedArt {
  image: SkImage;
  /** Local-space rect this image covers — feed straight to an ImageShader/Rect. */
  bounds: Box;
}

/**
 * Rasterises `nodes` into an offscreen surface sized to `bounds * dpr`, with
 * local space translated so `bounds`'s top-left maps to the surface origin.
 * Returns null if Skia refuses the surface allocation — callers should fall
 * back to a lower-fidelity draw mode rather than crash.
 */
export function bakeNodes(
  Skia: SkiaApi,
  nodes: Node[],
  bounds: Box,
  dpr: number,
  squishY = 1,
): BakedArt | null {
  const w = Math.ceil(bounds.width * dpr);
  const h = Math.ceil(bounds.height * dpr);
  if (w <= 0 || h <= 0) return null;
  // A raster surface, not `MakeOffscreen` (GPU-backed): this bake runs during
  // a `useMemo`/module init, not inside a live Skia draw pass — see the
  // identical reasoning in fish-picture.ts's `renderToImage`.
  const surface = Skia.Surface.Make(w, h);
  if (!surface) return null;
  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color("#00000000"));
  canvas.scale(dpr, dpr);
  canvas.translate(-bounds.x, -bounds.y);
  if (squishY !== 1) canvas.scale(1, squishY);
  const cache: PathCache = new Map();
  emit(Skia, canvas, nodes, cache);
  const image = surface.makeImageSnapshot();
  surface.dispose();
  return { image, bounds };
}

/** Bytes an RGBA8 raster image of `bounds` at `dpr` device pixels costs. */
export function bakeBytes(bounds: Box, dpr: number): number {
  return Math.ceil(bounds.width * dpr) * Math.ceil(bounds.height * dpr) * 4;
}

interface CacheEntry {
  art: BakedArt;
  bytes: number;
}

export interface BakeLru {
  get(key: string): BakedArt | undefined;
  set(key: string, art: BakedArt, bytes: number): void;
  readonly bytes: number;
}

/** Map iterates insertion order and `get` re-inserts on hit, so the first key is always LRU. */
export function createBakeLru(budgetBytes: number): BakeLru {
  const cache = new Map<string, CacheEntry>();
  let bytes = 0;
  const evictTo = (limit: number) => {
    for (const key of cache.keys()) {
      if (bytes <= limit) break;
      const entry = cache.get(key)!;
      bytes -= entry.bytes;
      cache.delete(key);
    }
  };
  return {
    get bytes() {
      return bytes;
    },
    get(key) {
      const hit = cache.get(key);
      if (!hit) return undefined;
      cache.delete(key);
      cache.set(key, hit);
      return hit.art;
    },
    set(key, art, entryBytes) {
      cache.set(key, { art, bytes: entryBytes });
      bytes += entryBytes;
      evictTo(budgetBytes);
    },
  };
}

/**
 * Bake density: physical pixels per local unit. Density-aware (unlike the old
 * pipeline's flat `BAKE_DPR = 3`, which over-samples on 1x/2x devices and
 * still aliases on 3x+ because it never enables mipmaps) — pair this with
 * `sampling={{ filter: Linear, mipmap: Linear }}` on the consuming ImageShader
 * so minification doesn't alias either.
 */
export function densityAwareDpr(pixelRatio: number, maxRenderScale: number): number {
  return Math.min(3, Math.max(1.5, pixelRatio * maxRenderScale * 1.15));
}
