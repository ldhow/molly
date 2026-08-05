// Third render-spec backend: an IMPERATIVE Skia emitter, plus a cache that
// bakes a fish once and replays it as a flat image.
//
// Why this exists. The declarative <PrimitiveNode> tree in fish-sprite.tsx is
// dozens of nodes per fish. At MAX_RENDERED_FISH the tank would rebuild all of
// that on EVERY frame, for art that never changes — only the fish's transform
// does. So: draw the spec once into an offscreen surface, snapshot it, and let
// the per-frame cost be a single textured quad.
//
// The tail is baked separately because it is the one part that animates
// (it rotates about `tailPivot` every frame).
//
// This file MUST stay behaviourally identical to the other two emitters. All
// three switch over the same union with an exhaustive default, so adding an IR
// case fails the build here rather than silently rendering nothing.

import {
  ClipOp,
  FillType,
  PaintStyle,
  Skia,
  StrokeCap,
  StrokeJoin,
  type SkCanvas,
  type SkImage,
  type SkPaint,
  type SkPath,
  type SkPicture,
} from "@shopify/react-native-skia";

import { getColorDef } from "@/shared/fish/catalog";
import { buildFishSpec, STAGE_SQUISH, type Box, type Primitive } from "@/shared/fish/render-spec";
import type { FishTraits, LifeStage } from "@/shared/fish/types";

/**
 * How the tank draws a fish.
 *  - "image":   bake to a texture. Cheapest per frame; blur and layers resolved
 *               once. The default.
 *  - "picture": record draw commands, replay each frame. No texture memory, but
 *               blur and saveLayer re-run every frame.
 *  - "nodes":   the declarative tree in fish-sprite.tsx. Slowest, but it is the
 *               reference implementation — switch here if a device misbehaves.
 * Each mode degrades to the next automatically if Skia cannot honour it.
 */
export const FISH_RENDER_MODE: "image" | "picture" | "nodes" = "image";

/**
 * Bakes are rasterised at this device-pixel factor. Fish render between 0.85×
 * and 1.15× scale, so baking a little above 1 keeps the largest ones crisp
 * without a cache key per scale.
 */
const BAKE_DPR = 3;

/** Total bytes of cached fish textures before the least-recent one is dropped. */
const CACHE_BUDGET_BYTES = 48 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Paint construction.
// ---------------------------------------------------------------------------

function assertNever(x: never): never {
  throw new Error(`fish-picture: unhandled IR case ${JSON.stringify(x)}`);
}

function makePaint(prim: Extract<Primitive, { paint: { color: string } }>): SkPaint {
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  paint.setColor(Skia.Color(prim.paint.color));
  paint.setAlphaf((prim.paint.opacity ?? 1) * paint.getAlphaf());

  if (prim.stroke) {
    paint.setStyle(PaintStyle.Stroke);
    paint.setStrokeWidth(prim.stroke.width);
    paint.setStrokeCap(StrokeCap.Round);
    paint.setStrokeJoin(StrokeJoin.Round);
  }
  return paint;
}

// ---------------------------------------------------------------------------
// The emitter.
// ---------------------------------------------------------------------------

/** One SkPath per unique `d`, shared across a whole fish. */
type PathCache = Map<string, SkPath>;

function pathFor(cache: PathCache, d: string): SkPath | null {
  let p = cache.get(d);
  if (!p) {
    const made = Skia.Path.MakeFromSVGString(d);
    if (!made) return null;
    // Patterns rely on even-odd-free winding; keep Skia's default explicitly so
    // self-overlapping blob paths fill the way the SVG backend fills them.
    made.setFillType(FillType.Winding);
    p = made;
    cache.set(d, p);
  }
  return p;
}

export function drawSpec(canvas: SkCanvas, prims: Primitive[], cache: PathCache): void {
  for (const prim of prims) {
    const clip = prim.clip ? pathFor(cache, prim.clip) : null;
    if (clip) {
      canvas.save();
      canvas.clipPath(clip, ClipOp.Intersect, true);
    }

    if (prim.kind === "group") {
      if (prim.opacity !== undefined && prim.opacity !== 1) {
        const layerPaint = Skia.Paint();
        layerPaint.setAlphaf(prim.opacity);
        canvas.saveLayer(layerPaint);
        drawSpec(canvas, prim.children, cache);
        canvas.restore();
      } else {
        drawSpec(canvas, prim.children, cache);
      }
    } else if (prim.kind === "circle") {
      canvas.drawCircle(prim.cx, prim.cy, prim.r, makePaint(prim));
    } else if (prim.kind === "path") {
      const path = pathFor(cache, prim.d);
      if (path) canvas.drawPath(path, makePaint(prim));
    } else {
      assertNever(prim);
    }

    if (clip) canvas.restore();
  }
}

// ---------------------------------------------------------------------------
// Baking + cache.
// ---------------------------------------------------------------------------

export interface BakedFish {
  /** Everything except the tail, already squished for the life stage. */
  body: SkImage | SkPicture;
  /** Drawn under a Group that rotates about `tailPivot`. */
  tail: SkImage | SkPicture;
  tailPivot: { x: number; y: number };
  /** Local-space rect the images occupy; feed straight to <Image x y w h>. */
  bounds: Box;
  kind: "image" | "picture";
}

interface CacheEntry {
  baked: BakedFish;
  bytes: number;
}

const cache = new Map<string, CacheEntry>();
let cacheBytes = 0;

function evictTo(limit: number) {
  // Map iterates in insertion order, and `get` re-inserts on hit, so the first
  // key is always the least recently used.
  for (const key of cache.keys()) {
    if (cacheBytes <= limit) break;
    const entry = cache.get(key)!;
    cacheBytes -= entry.bytes;
    cache.delete(key);
  }
}

function renderToImage(
  bounds: Box,
  squish: number,
  draw: (canvas: SkCanvas, cache: PathCache) => void,
  paths: PathCache,
): SkImage | null {
  const w = Math.ceil(bounds.width * BAKE_DPR);
  const h = Math.ceil(bounds.height * BAKE_DPR);
  const surface = Skia.Surface.MakeOffscreen(w, h);
  if (!surface) return null;
  const canvas = surface.getCanvas();
  canvas.scale(BAKE_DPR, BAKE_DPR);
  // Local space has its origin at the body centre; shift so `bounds` maps to
  // the surface's top-left.
  canvas.translate(-bounds.x, -bounds.y);
  canvas.scale(1, squish);
  draw(canvas, paths);
  const image = surface.makeImageSnapshot();
  // Detach from the surface so the texture survives the surface being freed.
  return image.makeNonTextureImage() ?? image;
}

function renderToPicture(
  bounds: Box,
  squish: number,
  draw: (canvas: SkCanvas, cache: PathCache) => void,
  paths: PathCache,
): SkPicture {
  const recorder = Skia.PictureRecorder();
  const canvas = recorder.beginRecording(
    Skia.XYWHRect(bounds.x, bounds.y, bounds.width, bounds.height),
  );
  canvas.scale(1, squish);
  draw(canvas, paths);
  return recorder.finishRecordingAsPicture();
}

/**
 * Bake (or fetch) the flattened drawing for one trait/stage combination.
 * Returns null when Skia refuses every mode, in which case the caller should
 * fall back to the declarative node tree.
 */
export function getBakedFish(traits: FishTraits, stage: LifeStage): BakedFish | null {
  if (FISH_RENDER_MODE === "nodes") return null;

  const key = `${traits.color}|${traits.body}|${traits.tail}|${traits.dorsal}|${stage}`;
  const hit = cache.get(key);
  if (hit) {
    // Re-insert so this key becomes the most recently used.
    cache.delete(key);
    cache.set(key, hit);
    return hit.baked;
  }

  const spec = buildFishSpec(traits, getColorDef(traits.color));
  const squish = STAGE_SQUISH[stage];
  const { bounds } = spec;
  const paths: PathCache = new Map();

  const drawBody = (c: SkCanvas, pc: PathCache) => drawSpec(c, spec.body, pc);
  const drawTail = (c: SkCanvas, pc: PathCache) => drawSpec(c, spec.tail, pc);

  let baked: BakedFish | null = null;

  if (FISH_RENDER_MODE === "image") {
    const body = renderToImage(bounds, squish, drawBody, paths);
    const tail = body ? renderToImage(bounds, squish, drawTail, paths) : null;
    if (body && tail) {
      baked = { body, tail, tailPivot: spec.tailPivot, bounds, kind: "image" };
    }
  }
  if (!baked) {
    // Either the mode asked for pictures, or MakeOffscreen was unavailable —
    // pictures need no GPU surface, so they always succeed.
    baked = {
      body: renderToPicture(bounds, squish, drawBody, paths),
      tail: renderToPicture(bounds, squish, drawTail, paths),
      tailPivot: spec.tailPivot,
      bounds,
      kind: "picture",
    };
  }

  // Pictures are command lists, not pixels; only textures are worth budgeting.
  const bytes =
    baked.kind === "image"
      ? Math.ceil(bounds.width * BAKE_DPR) * Math.ceil(bounds.height * BAKE_DPR) * 4 * 2
      : 0;
  cache.set(key, { baked, bytes });
  cacheBytes += bytes;
  evictTo(CACHE_BUDGET_BYTES);
  return baked;
}
