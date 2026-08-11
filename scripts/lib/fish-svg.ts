// SVG rendering backend for the fish IR, shared by fish-preview.ts (static
// gallery) and fish-color-editor.ts (live editor). Kept in one place so both
// tools stay byte-for-byte consistent with each other — see the "three
// backends over one IR" note at the top of src/shared/fish/render-spec.ts.

import {
  buildFishSpec,
  DEAD_GRAYSCALE_MATRIX,
  DEAD_OPACITY,
  eggSilhouetteSpec,
  eggSpec,
  maxFishBounds,
  SILHOUETTE_COLOR,
  STAGE_SQUISH,
  type Blend,
  type Paint,
  type Primitive,
} from "../../src/shared/fish/render-spec";
import { COLOR_DEFS } from "../../src/shared/fish/catalog";
import type { ColorDef, FishTraits } from "../../src/shared/fish/types";

export const STAGE_SCALE = { egg: 0.34, fry: 0.42, juvenile: 0.66, adult: 1 } as const;

// One frame wide enough for the tallest combination (a sailfin balloon).
// Body-only, so it's independent of which color is being previewed.
export const FRAME = maxFishBounds(COLOR_DEFS[0]);

const f = (n: number) => n.toFixed(1);

function deadFilter(id: string): string {
  return (
    `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">` +
    `<feColorMatrix type="matrix" values="${DEAD_GRAYSCALE_MATRIX.join(" ")}"/>` +
    `</filter>`
  );
}

let uid = 0;

interface SvgCtx {
  defs: string[];
  clips: Map<string, string>;
  blurs: Map<number, string>;
}

function newCtx(): SvgCtx {
  return { defs: [], clips: new Map(), blurs: new Map() };
}

function clipRef(ctx: SvgCtx, d: string): string {
  let id = ctx.clips.get(d);
  if (!id) {
    id = `clip${uid++}`;
    ctx.clips.set(d, id);
    ctx.defs.push(`<clipPath id="${id}"><path d="${d}"/></clipPath>`);
  }
  return id;
}

function blurRef(ctx: SvgCtx, sigma: number): string {
  let id = ctx.blurs.get(sigma);
  if (!id) {
    id = `blur${uid++}`;
    ctx.blurs.set(sigma, id);
    ctx.defs.push(
      `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%" ` +
        `color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${sigma}"/></filter>`,
    );
  }
  return id;
}

function paintAttrs(paint: Paint, ctx: SvgCtx): { fill: string; opacity: number } {
  const opacity = paint.opacity ?? 1;
  if (paint.type === "solid") return { fill: paint.color, opacity };

  const id = `g${uid++}`;
  const stops = paint.stops
    .map((s) => `<stop offset="${s.offset}" stop-color="${s.color}"/>`)
    .join("");

  if (paint.type === "linear") {
    ctx.defs.push(
      `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${paint.from.x}" y1="${paint.from.y}" x2="${paint.to.x}" y2="${paint.to.y}">${stops}</linearGradient>`,
    );
    return { fill: `url(#${id})`, opacity };
  }

  if (paint.type === "radial") {
    const { x: cx, y: cy } = paint.center;
    const s = paint.scale;
    const gt =
      s && (s.x !== 1 || s.y !== 1)
        ? ` gradientTransform="translate(${f(cx)} ${f(cy)}) scale(${s.x} ${s.y}) translate(${f(-cx)} ${f(-cy)})"`
        : "";
    ctx.defs.push(
      `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${f(cx)}" cy="${f(cy)}" r="${f(paint.radius)}"${gt}>${stops}</radialGradient>`,
    );
    return { fill: `url(#${id})`, opacity };
  }

  return assertNever(paint);
}

function assertNever(x: never): never {
  throw new Error(`fish-svg: unhandled IR case ${JSON.stringify(x)}`);
}

function cssBlend(blend: Blend): string {
  switch (blend) {
    case "srcOver":
      return "normal";
    case "multiply":
      return "multiply";
    case "screen":
      return "screen";
    case "overlay":
      return "overlay";
    case "softLight":
      return "soft-light";
    case "plusLighter":
      return "plus-lighter";
    default:
      return assertNever(blend);
  }
}

function commonAttrs(
  ctx: SvgCtx,
  o: { clip?: string; blend?: Blend; blur?: number; isolate?: boolean },
): string {
  let out = "";
  if (o.clip) out += ` clip-path="url(#${clipRef(ctx, o.clip)})"`;
  if (o.blur !== undefined && o.blur > 0) out += ` filter="url(#${blurRef(ctx, o.blur)})"`;
  const style: string[] = [];
  if (o.blend && o.blend !== "srcOver") style.push(`mix-blend-mode:${cssBlend(o.blend)}`);
  if (o.isolate) style.push("isolation:isolate");
  if (style.length) out += ` style="${style.join(";")}"`;
  return out;
}

function primitiveSvg(prim: Primitive, ctx: SvgCtx): string {
  if (prim.kind === "group") {
    const inner = prim.children.map((c) => primitiveSvg(c, ctx)).join("");
    let attrs = commonAttrs(ctx, prim);
    if (prim.opacity !== undefined && prim.opacity !== 1) attrs += ` opacity="${prim.opacity}"`;
    return `<g${attrs}>${inner}</g>`;
  }

  const { fill, opacity } = paintAttrs(prim.paint, ctx);
  const attrs = commonAttrs(ctx, prim);

  if (prim.kind === "circle") {
    return `<circle cx="${prim.cx}" cy="${prim.cy}" r="${prim.r}" fill="${fill}" opacity="${opacity}"${attrs}/>`;
  }
  if (prim.kind === "path") {
    if (prim.stroke) {
      return `<path d="${prim.d}" fill="none" stroke="${fill}" stroke-width="${prim.stroke.width}" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"${attrs}/>`;
    }
    return `<path d="${prim.d}" fill="${fill}" opacity="${opacity}"${attrs}/>`;
  }
  return assertNever(prim);
}

export interface FishSvgOpts {
  stage?: keyof typeof STAGE_SCALE;
  dead?: boolean;
  silhouette?: boolean;
}

/**
 * Same art as `fishSvg`, but with tail/body/front kept as separate markup
 * strings instead of one flattened `<svg>` — what an animated preview needs
 * to rotate the tail and pectoral independently, the same way `fish-sprite.tsx`
 * splits them into separately-transformed Skia groups. Adult scale only
 * (stage squish/scale is the caller's problem, same as the app applies it as
 * an outer transform around these three groups).
 */
export function fishSvgLayers(traits: FishTraits, def: ColorDef) {
  const ctx = newCtx();
  const spec = buildFishSpec(traits, def);
  const tailHtml = spec.tail.map((p) => primitiveSvg(p, ctx)).join("");
  const bodyHtml = spec.body.map((p) => primitiveSvg(p, ctx)).join("");
  const frontHtml = spec.front.map((p) => primitiveSvg(p, ctx)).join("");
  return {
    defsHtml: ctx.defs.join(""),
    tailHtml,
    bodyHtml,
    frontHtml,
    tailPivot: spec.tailPivot,
    pectoralPivot: spec.pectoralPivot,
    bounds: spec.bounds,
  };
}

/** Renders one fish to a standalone <svg>...</svg> string, exactly as the app draws it. */
export function fishSvg(traits: FishTraits, def: ColorDef, opts: FishSvgOpts = {}): string {
  const stage = opts.stage ?? "adult";
  const scale = STAGE_SCALE[stage];
  const squish = STAGE_SQUISH[stage];
  const ctx = newCtx();
  const defs = ctx.defs;
  let content: string;

  if (stage === "egg") {
    const prims = opts.silhouette ? eggSilhouetteSpec() : eggSpec();
    content = prims.map((p) => primitiveSvg(p, ctx)).join("");
  } else {
    const spec = buildFishSpec(traits, def);
    if (opts.silhouette) {
      content = spec.silhouetteDs
        .map((d) => `<path d="${d}" fill="${SILHOUETTE_COLOR}"/>`)
        .join("");
    } else {
      content =
        spec.tail.map((p) => primitiveSvg(p, ctx)).join("") +
        spec.body.map((p) => primitiveSvg(p, ctx)).join("") +
        spec.front.map((p) => primitiveSvg(p, ctx)).join("");
    }
  }

  const flip = opts.dead ? " scale(1,-1)" : "";
  let attrs = "";
  if (opts.dead) {
    const id = `dead${uid++}`;
    defs.push(deadFilter(id));
    attrs = ` filter="url(#${id})" opacity="${DEAD_OPACITY}"`;
  }
  return (
    `<svg viewBox="${f(FRAME.x)} ${f(FRAME.y)} ${f(FRAME.width)} ${f(FRAME.height)}" ` +
    `width="${f(FRAME.width)}" height="${f(FRAME.height)}"${attrs}>` +
    `<defs>${defs.join("")}</defs>` +
    `<g transform="scale(${scale})${flip} scale(1,${squish})">${content}</g>` +
    `</svg>`
  );
}
