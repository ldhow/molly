// The ONE imperative emitter for the Aquarium IR: `Node[]` -> Skia draw
// calls. Runs identically on-device (native Skia) and under Node
// (`scripts/lib/skia-node.ts`, CanvasKit-backed) because both expose the same
// `Skia` JS API shape — so `scripts/aquarium-preview.ts` renders pixel-exact
// evidence of what the app draws, with no second backend to keep in sync.
//
// Modelled on the existing `fish-picture.ts` emitter (same paint/blend/clip//
// blur handling), but there is deliberately no exhaustive-switch contract
// with a second implementation here — that discipline existed because the
// old pipeline had to keep an SVG preview honest. This one doesn't.

// Deep-imported from the package's platform-agnostic core, NOT the bare
// `@shopify/react-native-skia` specifier: the top-level package resolves (via
// its "react-native" field) to `src/index.ts`, which pulls in the component
// layer and transitively `react-native` — fine under Metro, fatal under a
// plain Node/tsx script. `./skia/types` is the part both the native runtime
// and `scripts/lib/skia-node.ts`'s CanvasKit build share, so importing it
// here is what lets this one emitter run in both places. Metro already
// transforms this package's raw TS source for the bare specifier, so it
// transforms this deep path exactly the same way.
import {
  BlendMode,
  BlurStyle,
  ClipOp,
  FillType,
  PaintStyle,
  StrokeCap,
  StrokeJoin,
  TileMode,
  type SkCanvas,
  type SkPaint,
  type SkPath,
  type SkShader,
} from "@shopify/react-native-skia/src/skia/types";

import type { Blend, Node, Paint } from "./ir";
import type { SkiaApi } from "./skia-types";

function assertNever(x: never): never {
  throw new Error(`aquarium/emit: unhandled IR case ${JSON.stringify(x)}`);
}

function blendMode(blend: Blend): BlendMode {
  switch (blend) {
    case "srcOver":
      return BlendMode.SrcOver;
    case "multiply":
      return BlendMode.Multiply;
    case "screen":
      return BlendMode.Screen;
    case "overlay":
      return BlendMode.Overlay;
    case "softLight":
      return BlendMode.SoftLight;
    case "plusLighter":
      // See fish-picture.ts's identical note: BlendMode.PlusLighter is a
      // custom SkSL blender that only exists on some native builds.
      // BlendMode.Plus is always present and close enough.
      return BlendMode.Plus;
    default:
      return assertNever(blend);
  }
}

function shaderFor(Skia: SkiaApi, paint: Paint): SkShader | null {
  switch (paint.type) {
    case "solid":
      return null;
    case "linear":
      return Skia.Shader.MakeLinearGradient(
        Skia.Point(paint.from.x, paint.from.y),
        Skia.Point(paint.to.x, paint.to.y),
        paint.stops.map((s) => Skia.Color(s.color)),
        paint.stops.map((s) => s.offset),
        TileMode.Clamp,
      );
    case "radial": {
      let localMatrix;
      const s = paint.scale;
      if (s && (s.x !== 1 || s.y !== 1)) {
        localMatrix = Skia.Matrix();
        localMatrix.translate(paint.center.x, paint.center.y);
        localMatrix.scale(s.x, s.y);
        localMatrix.translate(-paint.center.x, -paint.center.y);
      }
      return Skia.Shader.MakeRadialGradient(
        Skia.Point(paint.center.x, paint.center.y),
        paint.radius,
        paint.stops.map((st) => Skia.Color(st.color)),
        paint.stops.map((st) => st.offset),
        TileMode.Clamp,
        localMatrix,
      );
    }
    default:
      return assertNever(paint);
  }
}

function makePaint(Skia: SkiaApi, node: Extract<Node, { paint: Paint }>): SkPaint {
  const paint = Skia.Paint();
  paint.setAntiAlias(true);

  const shader = shaderFor(Skia, node.paint);
  if (shader) {
    paint.setShader(shader);
  } else if (node.paint.type === "solid") {
    paint.setColor(Skia.Color(node.paint.color));
  }
  paint.setAlphaf((node.paint.opacity ?? 1) * paint.getAlphaf());

  if (node.blend) paint.setBlendMode(blendMode(node.blend));
  if (node.blur !== undefined && node.blur > 0) {
    paint.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, node.blur, true));
  }
  if (node.kind === "path" && node.stroke) {
    paint.setStyle(PaintStyle.Stroke);
    paint.setStrokeWidth(node.stroke.width);
    paint.setStrokeCap(StrokeCap.Round);
    paint.setStrokeJoin(StrokeJoin.Round);
  }
  return paint;
}

/** One SkPath per unique `d`, shared across a whole draw. */
export type PathCache = Map<string, SkPath | null>;

function pathFor(Skia: SkiaApi, cache: PathCache, d: string): SkPath | null {
  if (cache.has(d)) return cache.get(d) ?? null;
  const made = Skia.Path.MakeFromSVGString(d);
  if (made) made.setFillType(FillType.Winding);
  cache.set(d, made ?? null);
  return made ?? null;
}

export function emit(Skia: SkiaApi, canvas: SkCanvas, nodes: Node[], cache: PathCache): void {
  for (const node of nodes) {
    const clip = node.clip ? pathFor(Skia, cache, node.clip) : null;
    if (clip) {
      canvas.save();
      canvas.clipPath(clip, ClipOp.Intersect, true);
    }

    if (node.kind === "group") {
      const t = node.transform;
      if (t) canvas.save();
      if (t?.translateX || t?.translateY) canvas.translate(t.translateX ?? 0, t.translateY ?? 0);
      if (t?.rotateDeg) canvas.rotate(t.rotateDeg, 0, 0);
      if (t?.scale !== undefined && t.scale !== 1) canvas.scale(t.scale, t.scale);

      const layerPaint = Skia.Paint();
      layerPaint.setAlphaf(node.opacity ?? 1);
      if (node.blend) layerPaint.setBlendMode(blendMode(node.blend));
      if (node.blur !== undefined && node.blur > 0) {
        layerPaint.setImageFilter(Skia.ImageFilter.MakeBlur(node.blur, node.blur, TileMode.Decal));
      }
      canvas.saveLayer(layerPaint);
      emit(Skia, canvas, node.children, cache);
      canvas.restore();
      if (t) canvas.restore();
    } else if (node.kind === "circle") {
      canvas.drawCircle(node.cx, node.cy, node.r, makePaint(Skia, node));
    } else if (node.kind === "path") {
      const path = pathFor(Skia, cache, node.d);
      if (path) canvas.drawPath(path, makePaint(Skia, node));
    } else {
      assertNever(node);
    }

    if (clip) canvas.restore();
  }
}
