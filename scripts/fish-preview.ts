// Generates src/docs/fish-preview.html — a static SVG gallery of every fish
// color × life stage (+ dead + locked silhouette) plus rolled-trait showcases,
// rendered from the SAME render-spec the app uses. Run: yarn fish:preview

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BODY_DEFS,
  COLOR_DEFS,
  DORSAL_DEFS,
  standardTraits,
  TAIL_DEFS,
} from "../src/shared/fish/catalog";
import { RARITY_COLORS, formatRarity } from "../src/shared/fish/rarity";
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
} from "../src/shared/fish/render-spec";
import type { ColorDef, FishTraits, UnlockRule } from "../src/shared/fish/types";

const STAGE_SCALE = { egg: 0.34, fry: 0.42, juvenile: 0.66, adult: 1 } as const;

// One frame for every cell, wide enough for the tallest combination (a sailfin
// balloon). Derived, not hardcoded — the old fixed viewBox clipped the sailfin
// crest by a pixel.
const FRAME = maxFishBounds(COLOR_DEFS[0]);

const f = (n: number) => n.toFixed(1);

/**
 * The dead-fish desaturation, as the exact matrix the app's ColorMatrix uses.
 * SVG filter regions default to bbox ±10%, which silently clips anything soft —
 * every filter this script emits carries an explicit oversized region.
 */
function deadFilter(id: string): string {
  return (
    `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">` +
    `<feColorMatrix type="matrix" values="${DEAD_GRAYSCALE_MATRIX.join(" ")}"/>` +
    `</filter>`
  );
}

let uid = 0;

/**
 * Per-<svg> emitter state. Clip paths and blur filters are memoised by content
 * so a body clip reused by 30 primitives costs one <clipPath>, matching how the
 * Skia backend compiles one SkPath per unique `d`.
 */
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

/**
 * A Gaussian blur filter. The oversized region is mandatory: SVG defaults a
 * filter to the bbox ±10%, which silently crops anything soft — a bug that
 * would show up ONLY in the preview and quietly break app/preview parity.
 */
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
    // Elliptical falloff: scale about the centre. Skia expresses the identical
    // thing as a `transform` on the gradient node.
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
  throw new Error(`fish-preview: unhandled IR case ${JSON.stringify(x)}`);
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

/** Shared attributes for anything drawable: clip, blur, blend, isolation. */
function commonAttrs(
  ctx: SvgCtx,
  o: { clip?: string; blend?: Blend; blur?: number; isolate?: boolean },
): string {
  let out = "";
  if (o.clip) out += ` clip-path="url(#${clipRef(ctx, o.clip)})"`;
  if (o.blur !== undefined && o.blur > 0) out += ` filter="url(#${blurRef(ctx, o.blur)})"`;
  const style: string[] = [];
  if (o.blend && o.blend !== "srcOver") style.push(`mix-blend-mode:${cssBlend(o.blend)}`);
  // `isolation:isolate` makes children blend against this group's own contents
  // rather than the water behind the fish — SVG's answer to Skia's
  // <Group layer={<Paint/>}>.
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

interface FishOpts {
  stage?: keyof typeof STAGE_SCALE;
  dead?: boolean;
  silhouette?: boolean;
}

function fishSvg(traits: FishTraits, def: ColorDef, opts: FishOpts = {}): string {
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
        spec.body.map((p) => primitiveSvg(p, ctx)).join("");
    }
  }

  // Dead fish: belly-up, desaturated with the SAME matrix + opacity the app
  // applies via Skia's ColorMatrix, so the two cannot drift.
  const flip = opts.dead ? " scale(1,-1)" : "";
  let attrs = "";
  if (opts.dead) {
    const id = `dead${uid++}`; // SVG ids are document-global — never reuse one
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

function unlockHintText(rule: UnlockRule): string {
  switch (rule.type) {
    case "default":
      return "Starter";
    case "sessionMinutes":
      return `Single ${rule.minutes}m session`;
    case "totalHours":
      return `${rule.hours}h total focus`;
    case "streakDays":
      return `${rule.days}-day streak`;
    case "streakOrGrant":
      return `${rule.days}-day streak / event`;
  }
}

function badge(text: string, color: string): string {
  return `<span class="badge" style="background:${color}22;color:${color};border-color:${color}55">${text}</span>`;
}

const colorRows = COLOR_DEFS.map((def) => {
  const traits = standardTraits(def.id);
  const cells = [
    fishSvg(traits, def, { stage: "adult" }),
    fishSvg(traits, def, { stage: "juvenile" }),
    fishSvg(traits, def, { stage: "fry" }),
    fishSvg(traits, def, { stage: "egg" }),
    fishSvg(traits, def, { stage: "adult", dead: true }),
    fishSvg(traits, def, { stage: "adult", silhouette: true }),
  ]
    .map((svg) => `<td>${svg}</td>`)
    .join("");
  const rarityColor = RARITY_COLORS[def.rarity.tier];
  return `<tr>
    <td class="meta">
      <div class="order">#${def.order}</div>
      <div class="name">${def.name}</div>
      ${badge(formatRarity(def.rarity), rarityColor)}
      <div class="hint">${unlockHintText(def.unlock)}</div>
      <div class="desc">${def.description}</div>
    </td>${cells}</tr>`;
}).join("\n");

const showcases: { label: string; traits: FishTraits }[] = [
  { label: "Balloon body (Gold Dust)", traits: { ...standardTraits("goldDust"), body: "balloon" } },
  { label: "Lyretail (Platinum)", traits: { ...standardTraits("platinum"), tail: "lyretail" } },
  { label: "Sailfin (Black)", traits: { ...standardTraits("black"), dorsal: "sailfin" } },
  {
    label: "All rare rolls (Sanke)",
    traits: { color: "sanke", body: "balloon", tail: "lyretail", dorsal: "sailfin" },
  },
];

const showcaseCells = showcases
  .map(({ label, traits }) => {
    const def = COLOR_DEFS.find((d) => d.id === traits.color)!;
    return `<div class="show"><div>${fishSvg(traits, def)}</div><div class="hint">${label}</div></div>`;
  })
  .join("");

const oddsRows = [
  ...BODY_DEFS.map((d) => ({ axis: "Body", ...d })),
  ...TAIL_DEFS.map((d) => ({ axis: "Tail", ...d })),
  ...DORSAL_DEFS.map((d) => ({ axis: "Dorsal", ...d })),
]
  .map(
    (d) =>
      `<tr><td>${d.axis}</td><td>${d.name}</td><td>${badge(formatRarity(d.rarity), RARITY_COLORS[d.rarity.tier])}</td><td>${d.weight}%</td></tr>`,
  )
  .join("");

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Molly fish preview</title>
<style>
  body { margin:0; padding:24px; font-family: -apple-system, "Segoe UI", sans-serif;
         background: linear-gradient(180deg, #0b3a5c 0%, #063049 45%, #02131f 100%);
         color:#eaf6ff; min-height:100vh; }
  h1 { font-size:22px; } h2 { font-size:16px; margin-top:32px; color:#8fb3cc; }
  table { border-collapse: collapse; }
  td { padding:6px 10px; vertical-align: middle; }
  thead td { color:#8fb3cc; font-size:12px; }
  tbody tr { border-top: 1px solid rgba(255,255,255,0.08); }
  .meta { min-width: 180px; }
  .order { color:#54788f; font-size:11px; }
  .name { font-weight:700; font-size:15px; }
  .hint { color:#8fb3cc; font-size:11px; margin-top:2px; }
  .desc { color:#54788f; font-size:11px; margin-top:2px; max-width:190px; }
  .badge { display:inline-block; font-size:10px; font-weight:700; padding:1px 8px;
           border-radius:99px; border:1px solid; margin-top:3px; }
  .shows { display:flex; gap:16px; flex-wrap:wrap; }
  .show { text-align:center; }
  .odds td { font-size:12px; }
</style></head><body>
<h1>🐟 Molly fish preview — ${COLOR_DEFS.length} colors</h1>
<p class="hint">Generated by scripts/fish-preview.ts from src/shared/fish/render-spec.ts — the exact drawing code the app uses. Regenerate with <code>yarn fish:preview</code>.</p>
<table>
<thead><tr><td>Variety</td><td>Adult</td><td>Juvenile</td><td>Fry</td><td>Egg</td><td>Dead</td><td>Locked</td></tr></thead>
<tbody>
${colorRows}
</tbody></table>
<h2 id="showcases">Rolled-trait showcases</h2>
<div class="shows">${showcaseCells}</div>
<h2 id="odds">Roll odds</h2>
<table class="odds"><thead><tr><td>Axis</td><td>Trait</td><td>Rarity</td><td>Weight</td></tr></thead>
<tbody>${oddsRows}</tbody></table>
</body></html>`;

const outPath = join(dirname(fileURLToPath(import.meta.url)), "../src/docs/fish-preview.html");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, html);
console.log(`Wrote ${outPath}`);
