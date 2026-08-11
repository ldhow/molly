// Bakes a fish's albedo (pigment, no lighting) into an RGBA byte buffer that
// can be uploaded as a texture. Pure — no three/Skia/React — so the app, the
// browser preview and the Node verification scripts all produce identical
// pixels from identical inputs.

import { boundsOf, flattenPath } from "../lib/path2d";

import { rasterizeSpec, type RasterTarget } from "./raster";
import { buildFishSpec } from "./render-spec";
import type { ColorDef, FishTraits } from "./types";

/**
 * Output pixels per local art unit.
 *
 * The body is ~113 units long and covers roughly a quarter of the screen in
 * tank mode — about 290 device pixels on a 3x phone. At 3 px/unit the texture
 * is ~340px across, so it is still above 1:1 there while costing ~45% less to
 * rasterize than 4 did. Bake cost is the binding constraint here, not
 * sharpness: this runs on the JS thread (see the queue in
 * fish-skin-texture.ts), so every millisecond is a millisecond of frame time.
 */
export const DEFAULT_PX_PER_UNIT = 3;

/** Slack around the silhouette so soft-edged patterns aren't cut off. */
const BOX_PAD = 4;

export interface SkinMap extends RasterTarget {
  /** Local-space rect the buffer covers — the UV projection needs this. */
  box: { x: number; y: number; width: number; height: number };
}

/**
 * Local-space bounds of the body silhouette, from the FLATTENED outline.
 *
 * Deliberately not `geom.bbox`: that field is a hand-entered approximation
 * that under-reports the real extent (it claims h=41 for the standard body,
 * while the curve actually spans 45.4 between backPeak and bellyLow). Using
 * it would crop the fish's back and belly out of the texture.
 */
export function bodyBox(bodyPathD: string) {
  const b = boundsOf(flattenPath(bodyPathD, { tolerance: 0.35 }));
  return {
    x: b.x - BOX_PAD,
    y: b.y - BOX_PAD,
    width: b.width + BOX_PAD * 2,
    height: b.height + BOX_PAD * 2,
  };
}

export interface SkinMapOptions {
  pxPerUnit?: number;
  supersample?: number;
}

/** Rasterize one fish's albedo. Deterministic for a given traits+def pair. */
export function buildSkinMap(
  traits: FishTraits,
  def: ColorDef,
  options: SkinMapOptions = {},
): SkinMap {
  const spec = buildFishSpec(traits, def);
  const box = bodyBox(spec.bodyPathD);
  const target = rasterizeSpec(spec.skinAlbedo, {
    box,
    pxPerUnit: options.pxPerUnit ?? DEFAULT_PX_PER_UNIT,
    supersample: options.supersample ?? 2,
  });
  return { ...target, box };
}

/** Stable cache key — everything that changes the pixels, nothing that doesn't. */
export function skinMapKey(traits: FishTraits): string {
  // Life stage is deliberately absent: STAGE_SQUISH is a mesh scale in 3D,
  // not baked pixels, so one map serves every stage.
  return `${traits.color}|${traits.body}|${traits.patternSeed ?? 0}`;
}
