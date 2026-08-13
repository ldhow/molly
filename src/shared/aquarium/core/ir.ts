// The Aquarium renderer's own IR — deliberately separate from
// `@/shared/fish/render-spec.ts`'s `Primitive`/`Paint` so this whole feature
// stays a self-contained tree (see the package README: delete this directory
// and nothing else breaks).
//
// Dependency-free: no React/RN/Skia imports. `emit.ts` is the one place that
// turns this into draw calls, against the real `Skia` object — either the
// on-device native one or `scripts/lib/skia-node.ts`'s CanvasKit-backed one,
// which are structurally the same JS API. That is what lets
// `scripts/aquarium-preview.ts` and `scripts/verify-aquarium.ts` render
// pixel-exact evidence of what the app draws, without a second emitter.

export interface XY {
  x: number;
  y: number;
}

/** Axis-aligned box in local space. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Stop {
  offset: number;
  color: string;
}

export type Paint =
  | { type: "solid"; color: string; opacity?: number }
  | { type: "linear"; from: XY; to: XY; stops: Stop[]; opacity?: number }
  | {
      type: "radial";
      center: XY;
      radius: number;
      stops: Stop[];
      opacity?: number;
      /** Non-uniform scale about `center` — an elliptical falloff. */
      scale?: XY;
    };

export type Blend = "srcOver" | "multiply" | "screen" | "overlay" | "softLight" | "plusLighter";

interface DrawCommon {
  paint: Paint;
  /** SVG path `d` to clip to. Memoised by string identity in `emit.ts`. */
  clip?: string;
  blend?: Blend;
  /** Gaussian sigma in local units, MASK-blur semantics (own alpha, no layer). */
  blur?: number;
}

/**
 * Translate, then rotate, then scale — in that order, each about the group's
 * own local origin. Enough to place an independently-authored piece (a leaf
 * on a stem, a plant at a scene position, driftwood at a driftwood anchor)
 * without hand-transforming its own path `d` strings, which is exactly the
 * class of bug this exists to prevent.
 */
export interface GroupTransform {
  translateX?: number;
  translateY?: number;
  rotateDeg?: number;
  scale?: number;
}

export type Node =
  | ({ kind: "path"; d: string; stroke?: { width: number } } & DrawCommon)
  | ({ kind: "circle"; cx: number; cy: number; r: number } & DrawCommon)
  | {
      kind: "group";
      children: Node[];
      clip?: string;
      blend?: Blend;
      opacity?: number;
      /** IMAGE-filter blur: blurs the composited result. Forces a layer. */
      blur?: number;
      /** Composite `blend` against this group's own contents, not the backdrop. */
      isolate?: boolean;
      transform?: GroupTransform;
    };

export function unionBox(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  return { x, y, width: right - x, height: bottom - y };
}

export function inflateBox(b: Box, pad: number): Box {
  return { x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2 };
}

export function boxContainsBox(outer: Box, inner: Box): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}
