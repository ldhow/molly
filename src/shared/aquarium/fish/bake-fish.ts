// Composes `anatomy.ts` (body geometry) + `fins.ts` (fin membranes) +
// `pigment.ts` (ported palette/pattern/shimmer/scales) into one drawable
// fish, and bakes it to a single texture.
//
// Draw order is the "buried root" trick real fish-art pipelines use (see
// `render-spec.ts`'s `pushFin`, the reference this ports): fins that attach
// BEHIND the body draw first, at low alpha where they're a depth cue (the
// far pectoral, far pelvic) or full alpha where they're not (dorsal, anal,
// near pelvic, caudal) — then the OPAQUE body skin fill draws over all of
// them, burying every root, so the seam between "fin" and "body" never
// shows. Only the near pectoral draws AFTER the skin, since a real pectoral
// sits on top of the flank, not behind it.
//
// Still ONE image per (traits, stage): the spine warp in `spine.ts` /
// `core/sksl/warp.ts` animates the whole baked texture — fins included — as
// one piece, which is what makes "fins are separate shapes" and "the fish
// bends as one organism" compatible instead of contradictory.

import { bakeBytes, bakeNodes, densityAwareDpr, type BakedArt } from "@/shared/aquarium/core/bake";
import {
  inflateBox,
  unionBox,
  type Box,
  type Node,
  type Paint,
  type XY,
} from "@/shared/aquarium/core/ir";
import {
  BODY_KEYLINE,
  countershadeStops,
  FIN_MEMBRANE,
  finTipAlpha,
  iridescenceBands,
  keylineColor,
  LIGHT_DIR,
  RIM_TINT,
  SPECULAR_TINT,
  tinted,
} from "@/shared/aquarium/core/shading";
import type { SkiaApi } from "@/shared/aquarium/core/skia-types";
import { getColorDef } from "@/shared/fish/catalog";
import type { ColorDef, FishTraits, LifeStage } from "@/shared/fish/types";
import { darken, rgba } from "@/shared/lib/color";

import { buildFishAnatomy, type FishAnatomy, type FishFins } from "./anatomy";
import { EYE_RADIUS, eyeNodes, eyeStyleFor, type EyeStyleId } from "./eyes";
import type { FinShape } from "./fins";
import { aquariumColorDef } from "./pattern-defs";
import {
  materialFor,
  patternPrimitives,
  scalePrimitives,
  shimmerPrimitive,
  sparklePrimitives,
  type PigmentGeom,
} from "./pigment";

/** Vertical squish per life stage — same values the old renderer uses. */
export const STAGE_SQUISH: Record<LifeStage, number> = {
  egg: 1,
  fry: 0.72,
  juvenile: 0.88,
  adult: 1,
};

type FinKey = keyof FishFins;

/**
 * Per-fin alpha multiplier by life stage — how "grown in" each fin is.
 * `fry` has none at all (a fry is a featureless blob with a nub of a tail);
 * `juvenile` has every fin but dimmer than its adult value; `adult`'s `1`
 * multipliers make `fin(...)`'s output identical to the pre-stage code path,
 * which matters because the tank screen and post-session result sheet both
 * hardcode `stage: "adult"` and must not visually change. `egg` is unused —
 * it never reaches `buildFishAquariumSpec` at all, see `bakeFish`.
 */
const STAGE_FIN_ALPHA: Record<LifeStage, Record<FinKey, number>> = {
  egg: {
    dorsal: 0,
    anal: 0,
    pelvicNear: 0,
    pelvicFar: 0,
    pectoralNear: 0,
    pectoralFar: 0,
    caudal: 0,
  },
  fry: {
    dorsal: 0,
    anal: 0,
    pelvicNear: 0,
    pelvicFar: 0,
    pectoralNear: 0,
    pectoralFar: 0,
    caudal: 0.5,
  },
  juvenile: {
    dorsal: 0.6,
    anal: 0.55,
    pelvicNear: 0.55,
    pelvicFar: 0.4,
    pectoralNear: 0.7,
    pectoralFar: 0.5,
    caudal: 0.85,
  },
  adult: {
    dorsal: 1,
    anal: 1,
    pelvicNear: 1,
    pelvicFar: 1,
    pectoralNear: 1,
    pectoralFar: 1,
    caudal: 1,
  },
};

/**
 * Opacity of the pattern/scale/shimmer/sparkle detail group by life stage —
 * "how developed is this fish's colouring." `1` (adult) pushes those nodes
 * unwrapped, byte-identical to the pre-stage code path; `0` (fry) skips
 * building them at all.
 */
const STAGE_DETAIL_OPACITY: Record<LifeStage, number> = {
  egg: 0,
  fry: 0,
  juvenile: 0.5,
  adult: 1,
};

const BOUNDS_PAD = 22;
const F = (n: number) => n.toFixed(1);

export interface FishAquariumSpec {
  nodes: Node[];
  bounds: Box;
  anatomy: FishAnatomy;
}

/**
 * One fin as a translucent membrane: root-opaque gradient fill, multiply ray
 * lines, a plusLighter light-catch along the pivot->tip axis, and a soft
 * outline — the "dark near the body, lighter toward the edges" look real fin
 * illustration references describe. `isolate: true` is mandatory: the
 * multiply rays and plusLighter catch must composite against the fin's own
 * fill, not whatever the water or body behind it happens to be.
 */
function finMembraneNodes(
  fin: FinShape,
  membranePaint: Paint,
  rayColor: string,
  outlineColor: string,
  /**
   * Path to stroke for the keyline, if different from the fin's own closed
   * `d` — the caudal fin passes `undefined` here (its hub-radiating edges
   * are covered by `silhouetteStrokeD` instead, see `buildFishAquariumSpec`)
   * so it isn't outlined twice at the peduncle.
   */
  strokeD: string | null = fin.d,
  /**
   * Drawn between the membrane fill and the rays — the caudal's peduncle
   * continuation (see `buildFishAquariumSpec`). Inside the group so it
   * inherits the fin's own alpha and isolation, and UNDER the rays so the
   * ray structure still reads across the root.
   */
  rootBlend: Node | null = null,
): Node {
  const children: Node[] = [
    { kind: "path", d: fin.d, paint: membranePaint },
    ...(rootBlend ? [rootBlend] : []),
    // Rays carry more of the fin now that the membrane is translucent: at
    // tank scale the fill alone no longer reads, and the rays are what keep
    // a see-through fin legible. See `FIN_MEMBRANE.RAY_BOOST`.
    ...fin.rays.map((d): Node => ({
      kind: "path",
      d,
      paint: {
        type: "solid",
        color: rayColor,
        opacity: Math.min(1, fin.rayAlpha * FIN_MEMBRANE.RAY_BOOST),
      },
      stroke: { width: 1 },
      blend: "multiply",
      clip: fin.d,
    })),
    {
      kind: "path",
      d: fin.d,
      blend: "plusLighter",
      blur: 2,
      clip: fin.d,
      paint: {
        type: "linear",
        from: fin.pivot,
        to: fin.tip,
        stops: [
          { offset: 0, color: "rgba(255,255,255,0)" },
          { offset: 0.35, color: "rgba(255,255,255,0.13)" },
          { offset: 1, color: "rgba(255,255,255,0)" },
        ],
      },
    },
  ];
  // Fin keyline — now a hint rather than a drawn edge. The membrane itself
  // carries the shape once it is genuinely translucent; a 0.62-alpha 1.5px
  // line around a see-through fin re-creates exactly the solid-paddle read
  // the translucency exists to remove. `null` skips this node entirely
  // (caudal — see `strokeD`'s doc comment above).
  if (strokeD) {
    children.push({
      kind: "path",
      d: strokeD,
      paint: { type: "solid", color: outlineColor, opacity: FIN_MEMBRANE.KEYLINE_ALPHA },
      stroke: { width: FIN_MEMBRANE.KEYLINE_WIDTH },
      blur: FIN_MEMBRANE.KEYLINE_BLUR,
    });
  }
  return { kind: "group", children, opacity: fin.alpha, isolate: true };
}

function finsBbox(fins: FishFins): Box {
  return Object.values(fins).reduce<Box | null>(
    (b, fin) => (b ? unionBox(b, fin.bbox) : fin.bbox),
    null,
  )!;
}

export function buildFishAquariumSpec(
  traits: FishTraits,
  def: ColorDef,
  stage: LifeStage = "adult",
  /**
   * Forces one eye style instead of the seed-derived one. TOOLING ONLY —
   * `scripts/aquarium-preview.ts` uses it to lay out one cell per style. It
   * is deliberately NOT part of `fishBakeKey`, so the app must never pass
   * it: two fish differing only by an override would collide in the cache.
   */
  eyeStyle?: EyeStyleId,
): FishAquariumSpec {
  const anatomy = buildFishAnatomy(traits);
  const { landmarks, outlineD, silhouetteStrokeD, fins } = anatomy;
  const aquaDef = aquariumColorDef(def);
  const material = materialFor(def.rarity.tier);
  const seed = traits.patternSeed ?? 0;
  const p = aquaDef.palette;
  // Every line on this fish — fin keylines, the gill crease, the eye ring —
  // shares the body contour's tone so they read as one animal's shading
  // rather than an ink pass laid over it. `coolShadow` via `keylineColor`,
  // not `darken`: mixing toward black gave a dead, hueless line.
  const outlineColor = keylineColor(p.back);

  const pigmentGeom: PigmentGeom = {
    d: outlineD,
    x0: landmarks.x0,
    length: landmarks.length,
    topAt: anatomy.baseTop,
    bottomAt: anatomy.baseBottom,
    nose: landmarks.nose,
    backPeak: landmarks.backPeak,
    bellyLow: landmarks.bellyLow,
    peduncleTop: landmarks.peduncleTop,
    halfHeight: landmarks.halfHeight,
  };
  const bp = landmarks.backPeak.y;
  const belly = landmarks.bellyLow.y;
  const px = landmarks.peduncleTop.x;

  // Every lighting cue below derives its placement from the one shared
  // `LIGHT_DIR` ("update 2d fish v2" plan Part E), which now lives in
  // `core/shading.ts` so the five creature renderers agree with the fish
  // about where the light comes from. Previously each cue (counter-shading
  // axis, gloss position, rim axis, AO shadow centre) was placed
  // independently and didn't visually agree; this is what makes them read as
  // one coherent light hitting a volumetric form instead of four unrelated
  // glows.
  const bodyCx = (landmarks.nose.x + px) / 2;
  const bodyCy = (bp + belly) / 2;

  // Face anchors, as fractions of the head (u-position + a fraction of the
  // local top/bottom half-height) rather than absolute pixel offsets from
  // the nose plane — a re-sculpted snout moves them automatically, which the
  // previous hand-tuned "nose.x + 21 / + 19 / + 20" constants could not do.
  const U_EYE = 0.155;
  const U_GILL = 0.26;
  const xAt = (u: number) => landmarks.x0 + u * landmarks.length;
  const topAt = (u: number) => -anatomy.baseTop(u);
  // How much deeper this body is than the standard body's own head — the
  // gill patch's hand-authored shape (proven to look right) scales with it
  // instead of a fixed-size patch looking undersized on balloon's head.
  const gillScale = landmarks.halfHeight / 28.5;

  // A real membrane, not a paddle — see `FIN_MEMBRANE`'s header for why the
  // root stays nearly opaque, why the hue is deliberately left alone, and
  // what the tip floor is protecting.
  const tipAlpha = finTipAlpha(material.finTrail);
  const finPaint = (pivot: XY, tip: XY): Paint => ({
    type: "linear",
    from: pivot,
    to: tip,
    stops: [
      { offset: 0, color: rgba(darken(p.fin, 0.24), FIN_MEMBRANE.ROOT_ALPHA) },
      { offset: 0.55, color: rgba(p.fin, FIN_MEMBRANE.MID_ALPHA) },
      { offset: 1, color: rgba(p.fin, tipAlpha) },
    ],
  });
  const rayColor = darken(p.finRay, 0.1);
  const finAlphaMul = STAGE_FIN_ALPHA[stage];
  // Returns `null` (rather than a zero-opacity node) when a fin hasn't grown
  // in yet at this stage — `fry` skips every fin but the caudal this way.
  // `mul >= 1` (adult, the common case) reuses `f` unchanged so the output is
  // byte-identical to the pre-stage code path.
  /**
   * Where a fin actually leaves the flank: `sink` units along the hub->tip
   * axis from the buried `pivot`.
   *
   * The membrane gradient used to be anchored at `pivot` itself, which for
   * every sunk fin (dorsal 7, anal 8/6, pelvic 4) put the dark opaque root
   * stop INSIDE the body where it is covered by the skin fill. The visible
   * fin therefore started partway along the ramp and read as one flat slab
   * of colour — the dorsal on the pale varieties looked like a lobe floating
   * above the back rather than something growing out of it. Anchoring here
   * gives the visible part of every fin the full dark-root -> translucent-tip
   * fall-off the membrane design always intended. The caudal and pectorals
   * have `sink` 0-1, so they are unaffected.
   */
  const emergence = (f: FinShape): XY => {
    const dx = f.tip.x - f.pivot.x;
    const dy = f.tip.y - f.pivot.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: f.pivot.x + (dx / len) * f.sink, y: f.pivot.y + (dy / len) * f.sink };
  };
  const fin = (f: FinShape, key: FinKey): Node | null => {
    const mul = finAlphaMul[key];
    if (mul <= 0) return null;
    const scaled = mul >= 1 ? f : { ...f, alpha: f.alpha * mul };
    return finMembraneNodes(scaled, finPaint(emergence(f), f.tip), rayColor, outlineColor);
  };

  // The caudal's own root tone: `p.mid` is the body skin gradient's own
  // middle stop, and the caudal hub sits at `peduncleMidY` — "the vertical
  // centre of the peduncle" per `anatomy.ts`'s `Landmarks` doc — so this is
  // the body's own colour at exactly the point the tail continues from,
  // full opacity, before easing into the fin's own tint. Without this the
  // tail was a differently-tinted, already-translucent membrane butting
  // straight against the opaque body at the peduncle — a colour seam on top
  // of (and independent from) the ink-outline seam `silhouetteStrokeD`
  // fixes below.
  const caudalPaint: Paint = {
    type: "linear",
    from: fins.caudal.pivot,
    to: fins.caudal.tip,
    stops: [
      { offset: 0, color: rgba(p.mid, FIN_MEMBRANE.CAUDAL_HUB_ALPHA) },
      { offset: 0.34, color: rgba(darken(p.fin, 0.24), FIN_MEMBRANE.CAUDAL_ROOT_ALPHA) },
      { offset: 0.62, color: rgba(p.fin, FIN_MEMBRANE.MID_ALPHA) },
      { offset: 1, color: rgba(p.fin, tipAlpha) },
    ],
  };

  const nodes: Node[] = [];
  const pushIf = (target: Node[], node: Node | null) => {
    if (node) target.push(node);
  };

  // Behind the body, buried at the root by the opaque skin fill drawn next.
  pushIf(nodes, fin(fins.pectoralFar, "pectoralFar"));
  pushIf(nodes, fin(fins.pelvicFar, "pelvicFar"));
  // `strokeD: null` — the caudal's outer margin is already inked as part of
  // `silhouetteStrokeD` below (one continuous line with the body), and its
  // hub-radiating edges are buried under the skin fill same as any other
  // "behind" fin; stroking `fin.d` here too would double-ink the same rim.
  const caudalMul = finAlphaMul.caudal;
  if (caudalMul > 0) {
    const caudalFin =
      caudalMul >= 1 ? fins.caudal : { ...fins.caudal, alpha: fins.caudal.alpha * caudalMul };
    // THE BODY DOES NOT STOP AT THE PEDUNCLE.
    //
    // The body fill carries a VERTICAL counter-shading ramp (dark dorsal ->
    // silver ventral) right up to the peduncle plane. The caudal's own
    // gradient runs pivot->tip, so at the root it is one FLAT horizontal
    // band. Two surfaces meeting along a vertical line, one graded across
    // that line and one not, read as two pieces glued together at EVERY
    // height — which is why matching the average tone (the `p.mid` hub stop
    // above) was never enough on its own, and why the tail still looked
    // detached once fin translucency made the mismatch easier to see.
    //
    // The fix carries the body's own ramp a SHORT way into the tail, on a
    // slab clipped to the caudal's fill whose alpha blurs out rearward.
    // `blur` here is MASK blur, so it softens the slab's alpha while the
    // vertical gradient inside it stays crisp — that is the whole trick.
    //
    // REACH IS THE WHOLE BALANCE, and it is easy to get wrong in the
    // generous direction: a first attempt at 0.4 of the tail with a matching
    // blur left goldDust's near-black caudal painted gold and zebra's white,
    // i.e. it fixed the seam by deleting the fin's own colour. This models a
    // fleshy peduncle stub, nothing more — past it the membrane is the
    // membrane.
    const caudalLen = Math.max(1, fins.caudal.tip.x - px);
    const rootReach = px + caudalLen * 0.12;
    const rootFront = px - landmarks.halfHeight * 1.2;
    const rootTop = bp * 1.6;
    const rootBottom = belly * 1.6;
    const caudalRootBlend: Node = {
      kind: "path",
      d:
        `M ${F(rootFront)} ${F(rootTop)} L ${F(rootReach)} ${F(rootTop)} ` +
        `L ${F(rootReach)} ${F(rootBottom)} L ${F(rootFront)} ${F(rootBottom)} Z`,
      clip: fins.caudal.d,
      blur: caudalLen * 0.1,
      paint: {
        type: "linear",
        from: { x: 0, y: bp },
        to: { x: 0, y: belly },
        stops: countershadeStops(p.back, p.mid, p.belly),
      },
    };
    nodes.push(
      finMembraneNodes(caudalFin, caudalPaint, rayColor, outlineColor, null, caudalRootBlend),
    );
  }
  pushIf(nodes, fin(fins.dorsal, "dorsal"));
  pushIf(nodes, fin(fins.anal, "anal"));
  pushIf(nodes, fin(fins.pelvicNear, "pelvicNear"));

  // How developed this fish's colouring is at this stage — pattern, scale
  // texture, shimmer and sparkle all fall under "detail" and fade in
  // together (0 for `fry`: a flat, featureless little body; 1 for `adult`:
  // unwrapped, byte-identical to the pre-stage code path).
  const detailOpacity = STAGE_DETAIL_OPACITY[stage];
  const pushStaged = (target: Node[], children: Node[]) => {
    if (!children.length) return;
    if (detailOpacity >= 1) target.push(...children);
    else target.push({ kind: "group", children, opacity: detailOpacity, isolate: true });
  };

  // The opaque body skin — everything above this line has its root buried.
  const skinAlbedo: Node[] = [
    {
      kind: "path",
      d: outlineD,
      paint: {
        type: "linear",
        from: { x: 0, y: bp },
        to: { x: 0, y: belly },
        // Real counter-shading, not a same-hue value ramp — see
        // `countershadeStops`. The catalogue's own back/mid/belly still own
        // the variety's colour; only the ramp's shape changed.
        stops: countershadeStops(p.back, p.mid, p.belly),
      },
    },
  ];
  const shimmer =
    detailOpacity > 0 && def.shimmer
      ? shimmerPrimitive(def.shimmer, pigmentGeom, material, seed)
      : null;
  const detailNodes: Node[] =
    detailOpacity > 0
      ? [
          ...patternPrimitives(def.id, aquaDef.pattern, pigmentGeom, material, seed),
          ...(shimmer ? [shimmer.base] : []),
          ...scalePrimitives(def, pigmentGeom, material, outlineD, seed),
          // Structural colour, over the pigment it competes with. Grouped
          // with the other "detail" so it fades in with life stage (a fry has
          // no sheen yet) and stays UNDER the core shadow/AO below, which is
          // what keeps the sheen from glowing on the fish's shadow side.
          ...iridescenceBands(outlineD, p.mid, bp, belly),
        ]
      : [];
  pushStaged(skinAlbedo, detailNodes);

  const skin: Node[] = [...skinAlbedo];
  // Curvature-aware core shadow, replacing the old straight top-to-bottom
  // counter-shading gradient (Part E). A RADIAL gradient centred off to the
  // LIGHT_DIR side of the body, with an elliptical scale matching the
  // body's own aspect, reads as wrapping around a lit cylinder rather than
  // a flat top-lit/bottom-lit fade: the light-facing flank sits close to
  // the gradient's bright centre, the far flank sits near its dark edge.
  // The final stop bounces back up slightly instead of crushing to black —
  // a cheap stand-in for ambient/bounce light on the shadow side.
  const shadeCx = bodyCx + LIGHT_DIR.x * landmarks.halfHeight * 1.1;
  const shadeCy = bodyCy + LIGHT_DIR.y * landmarks.halfHeight * 1.1;
  const bodyHalfLength = (px - landmarks.nose.x) / 2;
  skin.push({
    kind: "path",
    d: outlineD,
    clip: outlineD,
    paint: {
      type: "radial",
      center: { x: shadeCx, y: shadeCy },
      radius: landmarks.halfHeight * 2.6,
      scale: { x: bodyHalfLength / (landmarks.halfHeight * 1.3), y: 1 },
      stops: [
        { offset: 0, color: "rgba(255,255,255,0.14)" },
        { offset: 0.45, color: "rgba(0,0,0,0)" },
        { offset: 0.82, color: "rgba(0,0,0,0.32)" },
        { offset: 1, color: "rgba(0,0,0,0.16)" },
      ],
    },
  });
  // Rear/belly ambient occlusion — kept (it's what stops the body reading as
  // a flat decal) but tightened and pushed rearward so it shades the peduncle
  // rather than washing the whole lower half. A grounding shadow, not a
  // directional-light cue, so it stays independent of LIGHT_DIR.
  const shadowTone = darken(p.back, 0.6);
  skin.push({
    kind: "path",
    d: outlineD,
    blend: "multiply",
    paint: {
      type: "radial",
      center: { x: px * 0.78, y: belly * 0.6 },
      radius: landmarks.halfHeight * 1.5,
      scale: { x: 1.5, y: 1 },
      stops: [
        { offset: 0, color: rgba(shadowTone, 0.42) },
        { offset: 0.65, color: rgba(shadowTone, 0.1) },
        { offset: 1, color: rgba(shadowTone, 0) },
      ],
    },
  });
  // Two-tier specular (Part E): the existing soft bloom, now paired with a
  // small near-opaque hotspot at its centre — a real specular highlight
  // reads as a bright core plus a softer surrounding glow, not one uniform
  // ellipse. Both positioned along LIGHT_DIR from the body centre, so they
  // agree with the core shadow above about where the light is.
  //
  // `SPECULAR_TINT`, not white: the key light has already been filtered by
  // the water column before it gets here, and a pure-white highlight over
  // warm skin is the single clearest "plastic toy" cue. Peak is trimmed to
  // 0.75x for the same reason — the old value blew out the flank.
  const glossCx = bodyCx + LIGHT_DIR.x * landmarks.halfHeight * 0.75;
  const glossCy = bodyCy + LIGHT_DIR.y * landmarks.halfHeight * 0.75;
  const glossPeak = Math.min(0.95, material.gloss * 1.5 + material.bloom * 0.35) * 0.75;
  skin.push({
    kind: "path",
    d: outlineD,
    blend: "screen",
    blur: 2.2,
    clip: outlineD,
    paint: {
      type: "radial",
      center: { x: glossCx, y: glossCy },
      radius: landmarks.halfHeight * 0.5,
      scale: { x: 2.2, y: 1 },
      stops: [
        { offset: 0, color: tinted(SPECULAR_TINT, glossPeak) },
        { offset: 0.55, color: tinted(SPECULAR_TINT, glossPeak * 0.35) },
        { offset: 1, color: tinted(SPECULAR_TINT, 0) },
      ],
    },
  });
  skin.push({
    kind: "path",
    d: outlineD,
    blend: "screen",
    blur: 0.6,
    clip: outlineD,
    paint: {
      type: "radial",
      center: { x: glossCx, y: glossCy },
      radius: landmarks.halfHeight * 0.16,
      scale: { x: 1.6, y: 1 },
      stops: [
        { offset: 0, color: tinted(SPECULAR_TINT, Math.min(0.98, glossPeak * 1.35)) },
        { offset: 1, color: tinted(SPECULAR_TINT, 0) },
      ],
    },
  });
  // Grounded fins (Part E): a small soft shadow crescent where each
  // "behind"-layer fin meets the body, so a fin reads as socketed into the
  // flank rather than pasted flat on top. Complements (doesn't fight) Part
  // A's peduncle fix: A removes the FALSE hard line at the caudal joint,
  // this adds a SOFT occlusion cue at the flank fins, which is where such a
  // cue is physically correct.
  for (const groundedFin of [
    fins.dorsal,
    fins.anal,
    fins.pelvicNear,
    fins.pelvicFar,
    fins.pectoralFar,
  ]) {
    skin.push({
      kind: "circle",
      cx: groundedFin.pivot.x,
      cy: groundedFin.pivot.y,
      r: landmarks.halfHeight * 0.22,
      blend: "multiply",
      blur: landmarks.halfHeight * 0.12,
      paint: { type: "solid", color: rgba(shadowTone, 0.28) },
    });
  }

  nodes.push({ kind: "group", children: skin, isolate: true });

  // Gill cover. Position tracks the body via `xAt(U_GILL)`, and the
  // hand-authored leaf shape scales with `gillScale` so it doesn't look
  // undersized on a deeper head (balloon).
  //
  // AN OPERCULUM IS A MARGIN, NOT A PATCH. This used to fill the whole leaf
  // with flat `#ffffff` at 0.16 — which on a dark variety is a large
  // relative lift, so black and goldDust wore an obvious hard-edged pale
  // slab across the cheek. It was the loudest decal left on the fish. On a
  // real fish the plate is the same skin as the cheek around it; what you
  // actually see is its REAR MARGIN — a crease, with the plate lifting just
  // proud of the flank in front of it.
  //
  // So: no flat fill. A gradient that is nothing at the front of the plate
  // and only lifts as it approaches the margin, plus the crease itself,
  // which now fades out at both ends instead of terminating in hard caps.
  const gx = xAt(U_GILL);
  const gs = gillScale;
  const marginD = (dx: number) =>
    `M ${F(gx + dx)} ${F(bp + 7 * gs)} C ${F(gx + dx + 7 * gs)} ${F(bp + 15 * gs)} ` +
    `${F(gx + dx + 7 * gs)} ${F(6 * gs)} ${F(gx + dx)} ${F(15 * gs)}`;
  const gillMarginD = marginD(0);
  /** Vertical fade so the fold has no endpoints — shared by both margin passes. */
  const marginFade = (color: string, peak: number): Paint => ({
    type: "linear",
    from: { x: 0, y: bp + 7 * gs },
    to: { x: 0, y: 15 * gs },
    stops: [
      { offset: 0, color: rgba(color, 0) },
      { offset: 0.35, color: rgba(color, peak) },
      { offset: 0.75, color: rgba(color, peak * 0.9) },
      { offset: 1, color: rgba(color, 0) },
    ],
  });
  const gillPlateD =
    gillMarginD +
    ` C ${F(gx - 10 * gs)} ${F(13 * gs)} ${F(gx - 17 * gs)} ${F(4 * gs)} ${F(gx - 18 * gs)} ${F(-4 * gs)} ` +
    `C ${F(gx - 18 * gs)} ${F(-12 * gs)} ${F(gx - 11 * gs)} ${F(bp + 8 * gs)} ${F(gx)} ${F(bp + 7 * gs)} Z`;
  nodes.push({
    kind: "path",
    d: gillPlateD,
    clip: outlineD,
    blend: "screen",
    blur: 1.2,
    paint: {
      type: "linear",
      from: { x: gx - 18 * gs, y: 0 },
      to: { x: gx + 5 * gs, y: 0 },
      stops: [
        { offset: 0, color: tinted(SPECULAR_TINT, 0) },
        { offset: 0.6, color: tinted(SPECULAR_TINT, 0.03) },
        { offset: 1, color: tinted(SPECULAR_TINT, 0.13) },
      ],
    },
  });
  // The fold itself, as TWO passes: the crease's own shadow, and a light
  // catch on the plate edge just forward of it.
  //
  // Both are needed because neither works alone across the palette. The
  // crease is drawn in the body's keyline tone, which on `black`
  // (`coolShadow("#000000")`) is black-on-black and vanishes entirely — the
  // operculum is one of the strongest features of a real fish head, so
  // losing it is not an acceptable outcome of removing the old pale slab.
  // The light catch covers exactly that case, and on pale varieties it is
  // the crease that carries the read instead. A real fold has a shadow on
  // one side and a lit edge on the other anyway.
  nodes.push({
    kind: "path",
    d: gillMarginD,
    stroke: { width: 1.3 },
    blur: 0.5,
    clip: outlineD,
    paint: marginFade(outlineColor, 0.5),
  });
  nodes.push({
    kind: "path",
    d: marginD(-2 * gs),
    stroke: { width: 1.5 },
    blur: 1,
    blend: "screen",
    clip: outlineD,
    paint: marginFade(
      `#${SPECULAR_TINT.map((c) => c.toString(16).padStart(2, "0")).join("")}`,
      0.2,
    ),
  });

  // Contour — a form edge, NOT an ink outline. The mascot pass had this at
  // 0.88 alpha / 2.1px / blur 0.15, which was by far the biggest single thing
  // making the fish read as a sticker: it drew a hard border around an animal
  // that should just turn away from the light. `BODY_KEYLINE` puts it in the
  // same weight band the five creature renderers already use (0.6-1.4px), and
  // `keylineColor` rotates the tone cool instead of mixing toward black, so
  // the line reads as shaded skin rather than a drawn edge. `multiply` stays
  // dropped — it made the line's darkness depend on whatever it sat over.
  //
  // Strokes `silhouetteStrokeD`, NOT `outlineD` — the body's own outline
  // still ends in a straight peduncle edge (needed to close the FILL
  // polygon), but inking that edge draws a hard line straight across the
  // point where the tail attaches, independent of what the tail does behind
  // it. `silhouetteStrokeD` walks around the caudal fin's own outer rim
  // instead, so the ink line — not just the pixels — reads as one
  // continuous animal. See `anatomy.ts`'s `FishAnatomy.silhouetteStrokeD`.
  nodes.push({
    kind: "path",
    d: silhouetteStrokeD,
    paint: { type: "solid", color: outlineColor, opacity: BODY_KEYLINE.ALPHA },
    stroke: { width: BODY_KEYLINE.WIDTH },
    blur: BODY_KEYLINE.BLUR,
  });
  // Rim light (Part E): axis re-derived from LIGHT_DIR instead of the old
  // fixed nose-belly -> peduncle-back diagonal — `from` sits toward the
  // LIGHT side (weakest rim, since a rim catches light wrapping around the
  // silhouette on the side AWAY from the source), `to` toward the shadow
  // side (strongest). Physically correct rim placement is asymmetric by
  // construction here, which is what actually sells it as a rim rather than
  // a second highlight.
  const rimFrom = {
    x: bodyCx + LIGHT_DIR.x * bodyHalfLength,
    y: bodyCy + LIGHT_DIR.y * landmarks.halfHeight,
  };
  const rimTo = {
    x: bodyCx - LIGHT_DIR.x * bodyHalfLength,
    y: bodyCy - LIGHT_DIR.y * landmarks.halfHeight,
  };
  //
  // Strokes and clips `silhouetteStrokeD`, NOT `outlineD` — the same
  // correction the ink keyline above already had, which this node was simply
  // never switched over to. `outlineD` closes with a straight peduncle
  // end-cap, so stroking it painted a bright vertical bar straight across
  // the tail joint; and because `rimTo` sits toward the rear/shadow side,
  // the gradient is at MAXIMUM strength exactly there. That bar, running up
  // from the belly line, was the white seam that made the tail look stuck on
  // as a separate piece. Clipping to `silhouetteStrokeD` (a closed path
  // enclosing body AND caudal) additionally lets the rim carry on around the
  // tail's own margin, which is where light wrapping the silhouette would
  // really go.
  nodes.push({
    kind: "path",
    d: silhouetteStrokeD,
    stroke: { width: 2 },
    blend: "plusLighter",
    blur: 0.8,
    clip: silhouetteStrokeD,
    paint: {
      type: "linear",
      from: rimFrom,
      to: rimTo,
      // `RIM_TINT` is cooler than the specular: a rim is light that has
      // wrapped around the silhouette through MORE water than the highlight.
      stops: [
        { offset: 0, color: tinted(RIM_TINT, 0) },
        { offset: 0.55, color: tinted(RIM_TINT, material.rim * 0.32 * 0.75) },
        { offset: 1, color: tinted(RIM_TINT, material.rim * 0.75) },
      ],
    },
  });
  pushStaged(nodes, [
    ...(shimmer?.accents ?? []),
    ...(detailOpacity > 0 ? sparklePrimitives(pigmentGeom, def.rarity.tier, seed) : []),
  ]);

  // Only the near pectoral overlays the flank AFTER the skin — a real
  // pectoral sits on top, not buried behind it.
  pushIf(nodes, fin(fins.pectoralNear, "pectoralNear"));

  // Mouth. A molly's is small, terminal and upturned — it sits at the very
  // tip of the snout, not as a bar across the middle of it.
  //
  // This was two parallel hard strokes (a 1.6px `#000` at 0.5 and a 1.3px
  // `#fff` at 0.28) that read as a dash with a second dash floating above
  // it, most obvious on the pale varieties. Now: one shorter line that fades
  // to nothing at its rear end the way a real mouth line does, in the body's
  // own keyline tone rather than pure black, plus a much subtler lip catch
  // confined to the front half where the lip actually turns up into the
  // light.
  const nx = landmarks.nose.x;
  const ny = landmarks.nose.y;
  nodes.push({
    kind: "path",
    d: `M ${F(nx + 0.5)} ${F(ny + 3)} C ${F(nx + 2.5)} ${F(ny + 4.4)} ${F(nx + 4.5)} ${F(ny + 5.1)} ${F(nx + 7)} ${F(ny + 5.3)}`,
    stroke: { width: 1.25 },
    blur: 0.3,
    clip: outlineD,
    paint: {
      type: "linear",
      from: { x: nx, y: 0 },
      to: { x: nx + 7, y: 0 },
      stops: [
        { offset: 0, color: rgba(outlineColor, 0.78) },
        { offset: 0.55, color: rgba(outlineColor, 0.5) },
        { offset: 1, color: rgba(outlineColor, 0) },
      ],
    },
  });
  nodes.push({
    kind: "path",
    d: `M ${F(nx + 1)} ${F(ny + 1.4)} C ${F(nx + 3)} ${F(ny + 2.2)} ${F(nx + 5)} ${F(ny + 2.6)} ${F(nx + 6.5)} ${F(ny + 2.7)}`,
    stroke: { width: 1 },
    blur: 0.5,
    blend: "screen",
    clip: outlineD,
    paint: {
      type: "linear",
      from: { x: nx, y: 0 },
      to: { x: nx + 6.5, y: 0 },
      stops: [
        { offset: 0, color: tinted(SPECULAR_TINT, 0.22) },
        { offset: 1, color: tinted(SPECULAR_TINT, 0) },
      ],
    },
  });

  // The pink cheek blush that used to sit at `U_BLUSH` is gone. It had
  // already been "dialled down" once on the grounds that cute comes from
  // proportion rather than a decal — and it was the one element on the fish
  // with no physical referent at all, so the naturalism pass removed it
  // rather than dialling it down a third time.

  // Eye — the mascot pass's scaled-up sclera/ring/pupil/catchlight structure
  // is kept intact; `eyes.ts` adds the iris it was missing (the thing that
  // most made it read as a painted dot) and turns the single hardcoded eye
  // into a set of styles picked per individual from `seed`. Position still
  // comes from the head's own `u`-fraction landmarks; the RADIUS stays an
  // authored constant, not a body-derived one — see `eyes.ts`'s header.
  nodes.push(
    ...eyeNodes(eyeStyle ?? eyeStyleFor(def.id, seed), {
      center: { x: xAt(U_EYE), y: topAt(U_EYE) * 0.42 },
      r: EYE_RADIUS,
      outlineColor,
      irisColor: p.fin,
    }),
  );

  const bounds = inflateBox(unionBox(landmarks.bbox, finsBbox(fins)), BOUNDS_PAD);

  return { nodes, bounds, anatomy };
}

/** Flat single-colour fill for locked Fishdex entries — mirrors the legacy renderer's `SILHOUETTE_COLOR`. */
export const SILHOUETTE_COLOR = "#0a1b29";

/**
 * A flat, colour-blind silhouette of the fish's real shape (body + every
 * fin — no pigment, pattern, or face) for Fishdex entries the player hasn't
 * unlocked yet: recognisable as "a fish" without revealing which colour it
 * actually is. Deliberately reuses `buildFishAnatomy` (real body/tail/dorsal
 * shape) rather than a generic placeholder blob, and `fishSilhouetteBakeKey`
 * deliberately excludes `color`/`patternSeed` — every locked colour that
 * shares a body/tail/dorsal combo shares one cached bake.
 */
export function buildFishSilhouetteSpec(traits: FishTraits): { nodes: Node[]; bounds: Box } {
  const { landmarks, outlineD, fins } = buildFishAnatomy(traits);
  const flatFill: Paint = { type: "solid", color: SILHOUETTE_COLOR };
  const nodes: Node[] = [
    ...Object.values(fins).map((fin): Node => ({ kind: "path", d: fin.d, paint: flatFill })),
    { kind: "path", d: outlineD, paint: flatFill },
  ];
  const bounds = inflateBox(unionBox(landmarks.bbox, finsBbox(fins)), BOUNDS_PAD);
  return { nodes, bounds };
}

export function fishSilhouetteBakeKey(traits: FishTraits): string {
  return `${traits.body}|${traits.tail}|${traits.dorsal}|silhouette`;
}

export function bakeFishSilhouette(
  Skia: SkiaApi,
  traits: FishTraits,
  dpr: number,
): BakedArt | null {
  const { nodes, bounds } = buildFishSilhouetteSpec(traits);
  return bakeNodes(Skia, nodes, bounds, dpr);
}

const EGG_RX = 17;
const EGG_RY = 21;

/** Standard 4-cubic circle-to-ellipse Bezier approximation. */
function ellipsePathD(cx: number, cy: number, rx: number, ry: number): string {
  const k = 0.5522847498;
  const ox = rx * k;
  const oy = ry * k;
  return (
    `M ${F(cx - rx)} ${F(cy)} ` +
    `C ${F(cx - rx)} ${F(cy - oy)} ${F(cx - ox)} ${F(cy - ry)} ${F(cx)} ${F(cy - ry)} ` +
    `C ${F(cx + ox)} ${F(cy - ry)} ${F(cx + rx)} ${F(cy - oy)} ${F(cx + rx)} ${F(cy)} ` +
    `C ${F(cx + rx)} ${F(cy + oy)} ${F(cx + ox)} ${F(cy + ry)} ${F(cx)} ${F(cy + ry)} ` +
    `C ${F(cx - ox)} ${F(cy + ry)} ${F(cx - rx)} ${F(cy + oy)} ${F(cx - rx)} ${F(cy)} Z`
  );
}

/**
 * The `egg` stage bypass — a plain yellow oval, independent of `traits`
 * (what colour it hatches into stays a surprise): no eyes, no fins, no
 * pattern, and no dependency on `buildFishAnatomy`/`fins.ts` at all.
 */
export function buildEggAquariumSpec(): { nodes: Node[]; bounds: Box } {
  const eggD = ellipsePathD(0, 0, EGG_RX, EGG_RY);
  const shellOutline = darken("#f6c945", 0.5);

  const nodes: Node[] = [
    {
      kind: "path",
      d: eggD,
      paint: {
        type: "linear",
        from: { x: 0, y: -EGG_RY },
        to: { x: 0, y: EGG_RY },
        stops: [
          { offset: 0, color: "#fde79a" },
          { offset: 0.5, color: "#f6c945" },
          { offset: 1, color: "#dba213" },
        ],
      },
    },
    // Grounding shadow — same soft occlusion-crescent trick the body uses.
    {
      kind: "circle",
      cx: 0,
      cy: EGG_RY * 0.55,
      r: EGG_RY * 0.7,
      blend: "multiply",
      blur: EGG_RY * 0.25,
      clip: eggD,
      paint: { type: "solid", color: rgba(shellOutline, 0.3) },
    },
    // Glossy highlight — a wet shell reads as reflective, not matte.
    {
      kind: "path",
      d: eggD,
      blend: "screen",
      blur: 1.5,
      clip: eggD,
      paint: {
        type: "radial",
        center: { x: -EGG_RX * 0.35, y: -EGG_RY * 0.5 },
        radius: EGG_RX * 0.55,
        scale: { x: 1, y: 1.3 },
        stops: [
          { offset: 0, color: "rgba(255,255,255,0.85)" },
          { offset: 0.6, color: "rgba(255,255,255,0.25)" },
          { offset: 1, color: "rgba(255,255,255,0)" },
        ],
      },
    },
    // Shell keyline.
    {
      kind: "path",
      d: eggD,
      paint: { type: "solid", color: shellOutline, opacity: 0.55 },
      stroke: { width: 1.4 },
      blur: 0.2,
    },
  ];

  const bounds = inflateBox(
    { x: -EGG_RX, y: -EGG_RY, width: EGG_RX * 2, height: EGG_RY * 2 },
    BOUNDS_PAD,
  );
  return { nodes, bounds };
}

/** `(traits, stage)` -> a cache key stable across renders, per the React Compiler note in the plan. */
export function fishBakeKey(traits: FishTraits, stage: LifeStage): string {
  return `${traits.color}|${traits.body}|${traits.tail}|${traits.dorsal}|${traits.patternSeed ?? 0}|${stage}`;
}

export function bakeFish(
  Skia: SkiaApi,
  traits: FishTraits,
  stage: LifeStage,
  dpr: number,
  /** Tooling-only eye-style override — see `buildFishAquariumSpec`. */
  eyeStyle?: EyeStyleId,
): BakedArt | null {
  if (stage === "egg") {
    const { nodes, bounds } = buildEggAquariumSpec();
    return bakeNodes(Skia, nodes, bounds, dpr, STAGE_SQUISH.egg);
  }
  const def = getColorDef(traits.color);
  const { nodes, bounds } = buildFishAquariumSpec(traits, def, stage, eyeStyle);
  return bakeNodes(Skia, nodes, bounds, dpr, STAGE_SQUISH[stage]);
}

export { densityAwareDpr, bakeBytes };
