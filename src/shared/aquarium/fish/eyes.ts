// The fish's eye, as a small set of authored styles.
//
// WHY IT LOOKS THE WAY IT DOES. Two rewrites landed here. The first split one
// hardcoded block in `bake-fish.ts` into five seed-picked styles and gave
// every one an IRIS between sclera and pupil — the structure whose absence
// made the original read as a painted dot.
//
// The second (this one) fixed what that still got wrong, which was the whole
// premise: it drew a MAMMAL'S eye. A big white sclera ring around a small
// dark pupil is a cartoon/human convention. **A fish has no visible white.**
// Its eye is an iris filling nearly the whole opening — usually metallic,
// brightest at its outer edge, with a dark limbal ring — around a wide, deep
// pupil, the whole thing under a wet corneal dome. That is the single
// biggest thing that was making the eye read as fake, and no amount of
// tuning the old proportions could have fixed it.
//
// The other four changes, in rough order of how much they matter:
//
// 1. **A corneal dome** (`corneaNodes`). A broad soft `screen` sheen across
//    the upper-left of the WHOLE eye, not just a dot on the pupil. An eye is
//    a wet convex lens; this is what makes it read as glass instead of as
//    flat discs of colour.
// 2. **A graded iris** (`irisNodes`), dark at the pupil margin, bright and
//    metallic toward the rim, with a dark limbal ring at the very edge. The
//    old iris was one flat disc plus a vignette.
// 3. **Layered speculars** (`specularNodes`): a small hard core, a soft halo
//    around it, and a dim cool bounce low on the opposite side — light
//    coming back up off the substrate. One hard white dot is a sticker; core
//    plus halo plus bounce is a reflection.
// 4. **The eye is SEATED** (`socketShadow`), with a soft occlusion ring just
//    outside it, the same cue `bake-fish.ts` uses to socket the fins. Before
//    this the eye was pasted onto the flank with nothing holding it there.
//
// The near-black 1.7px ink ring is gone with the rest of the mascot pass —
// it is now a thin, low-alpha crease in the body's own cool keyline tone.
// Contrast has NOT dropped, which matters because tank mode draws fish at
// `AQUARIUM_FISH_SCALE = 0.6`: the read is now bright metallic iris against
// near-black pupil rather than white sclera against black dot, which is both
// more legible at size and what a real fish actually looks like.
//
// Radius is an authored constant (`EYE_RADIUS`), never derived from the
// body's own `halfHeight` — the same call `anatomy.ts` makes for fins with
// `FIN_REF_HALF_HEIGHT`. `balloon`'s silhouette is ~33% deeper than
// `standard`'s because it is a rounder shape, not because its features
// should be proportionally bigger. Only the eye's POSITION tracks the body,
// through `bake-fish.ts`'s `xAt(U_EYE)` / `topAt(U_EYE)` landmarks.
//
// Dependency-free: no React/RN/Skia. Runs under plain Node.

import type { Node, XY } from "@/shared/aquarium/core/ir";
import { f, seededKey } from "@/shared/aquarium/core/pigment-toolkit";
import {
  coolShadow,
  RIM_TINT,
  SPECULAR_TINT,
  tinted,
  warmLight,
} from "@/shared/aquarium/core/shading";
import { hexToHsl, hslToHex, mix, parseHex, relativeLuminance, rgba } from "@/shared/lib/color";
import { makeRng } from "@/shared/lib/rng";

export type EyeStyleId = "classic" | "ringed" | "almond" | "deep" | "hooded";

/** Authored base radius — the value the mascot pass settled on (`r` 4.8 -> 6.3). */
export const EYE_RADIUS = 6.3;

export interface EyeContext {
  /** Eye centre in body-local coordinates, from the head's `u`-fraction landmarks. */
  center: XY;
  /** Base radius; a style may scale modestly off this as part of its character. */
  r: number;
  /** The body's own keyline colour — lids and rims share it so the face reads as one drawing. */
  outlineColor: string;
  /** Iris tint, taken from this fish's own palette so the eye coordinates with the variety. */
  irisColor: string;
}

export type EyeStyleFn = (ctx: EyeContext) => Node[];

const PUPIL = "#04060a";
/** What shows at the opening's edge where a cartoon would put white. Wet, dark, neutral. */
const SOCKET = "#141922";

/** A closed ellipse as a path `d` — the IR has a `circle` node but no ellipse. */
function ellipseD(cx: number, cy: number, rx: number, ry: number): string {
  return (
    `M ${f(cx - rx)} ${f(cy)} ` +
    `a ${f(rx)} ${f(ry)} 0 1 0 ${f(rx * 2)} 0 ` +
    `a ${f(rx)} ${f(ry)} 0 1 0 ${f(-rx * 2)} 0 Z`
  );
}

/**
 * The metallic a too-dark iris is pulled toward. Real fish irises are
 * structural — gold, brass, silver — largely independently of body colour,
 * which is exactly why this is a fixed target and not a derived one.
 */
const IRIS_METAL = "#c8a53f";

/** Lightness ceiling for an iris — above this it stops reading as one. */
const IRIS_MAX_L = 0.68;

/**
 * Conditions a palette colour into an iris tint that still separates from
 * the near-black pupil.
 *
 * Raw `palette.fin` is the right hue — it's what ties the eye to the variety
 * — but many varieties have near-black fins (goldDust, black, chocolate), and
 * on those an unconditioned iris merges into the pupil and reads as one
 * oversized dot.
 *
 * Those dark tints are pulled toward `IRIS_METAL`, NOT toward white. Mixing
 * toward white is what the previous version did, and it turned goldDust's
 * near-black `#20222b` fin into a pale grey band — which is a white sclera
 * by another name, i.e. the exact thing this module was rewritten to remove.
 * Bright varieties still pass through nearly untouched and keep their own
 * palette colour.
 */
function irisTone(hex: string): string {
  const pull = Math.max(0, 0.72 - relativeLuminance(hex) * 2.6);
  const metal = parseHex(IRIS_METAL);
  const pulled = pull > 0 && metal ? mix(hex, metal, Math.min(0.85, pull)) : hex;
  // ...and a ceiling at the other end. platinum and zebra have near-white
  // fins, which passed straight through and gave them a WHITE iris ring —
  // the sclera read creeping back in from the light side after it had been
  // designed out on the dark side. No real iris is white; cap it into
  // metallic territory.
  const { h, s, l } = hexToHsl(pulled);
  return l > IRIS_MAX_L ? hslToHex(h, Math.max(s, 0.18), IRIS_MAX_L) : pulled;
}

/**
 * A soft dark ring just OUTSIDE the eye, drawn before it. Same cue
 * `bake-fish.ts` uses to socket a fin into the flank: without it the eye is a
 * decal sitting on the skin rather than an opening in it.
 */
function socketShadow(cx: number, cy: number, r: number, outlineColor: string): Node {
  return {
    kind: "circle",
    cx,
    cy,
    r: r * 1.2,
    blend: "multiply",
    blur: r * 0.3,
    paint: { type: "solid", color: rgba(outlineColor, 0.34) },
  };
}

/**
 * The iris, as the eye's main surface rather than a ring around a white one.
 *
 * Graded on purpose: darkest at the pupil margin, brightening outward to a
 * metallic band, then a dark limbal ring at the very rim. That progression is
 * what a real iris does, and it is the difference between a disc of colour
 * and something that looks lit.
 */
function irisNodes(cx: number, cy: number, r: number, irisColor: string): Node[] {
  const base = irisTone(irisColor);
  return [
    { kind: "circle", cx, cy, r, paint: { type: "solid", color: base } },
    {
      kind: "circle",
      cx,
      cy,
      r,
      paint: {
        type: "radial",
        center: { x: cx, y: cy },
        radius: r,
        stops: [
          { offset: 0, color: rgba(coolShadow(base, 0.55), 0.95) },
          { offset: 0.5, color: rgba(base, 0.15) },
          { offset: 0.84, color: rgba(warmLight(base, 0.34), 0.75) },
          { offset: 1, color: rgba(coolShadow(base, 0.62), 0.85) },
        ],
      },
    },
  ];
}

/**
 * The pupil. Barely blurred — enough that it isn't a stamped circle, not
 * enough to go soft. It has to stay a genuinely DARK hole: the eye's whole
 * read at tank scale is bright metallic iris against near-black pupil, and
 * anything that lifts this toward grey collapses that contrast.
 */
function pupilNode(cx: number, cy: number, r: number): Node {
  return {
    kind: "circle",
    cx,
    cy,
    r,
    blur: 0.15,
    paint: { type: "solid", color: PUPIL },
  };
}

/**
 * The wet lens. A soft `screen` sheen from the light side — this, not the
 * catchlight, is what reads as "glassy".
 *
 * Deliberately weak and tight. A first version ran it at 0.32 across a
 * radius of 1.45r and greyed the pupil out completely, which cost far more
 * (the eye stopped having a dark centre at all) than the wetness gained. A
 * real cornea highlight is confined to the light-facing quadrant; the rest
 * of the lens is just clear.
 */
function corneaNodes(cx: number, cy: number, r: number, clipD: string): Node {
  return {
    kind: "path",
    d: clipD,
    clip: clipD,
    blend: "screen",
    paint: {
      type: "radial",
      center: { x: cx - r * 0.44, y: cy - r * 0.5 },
      radius: r * 0.95,
      stops: [
        { offset: 0, color: tinted(SPECULAR_TINT, 0.2) },
        { offset: 0.55, color: tinted(SPECULAR_TINT, 0.05) },
        { offset: 1, color: tinted(SPECULAR_TINT, 0) },
      ],
    },
  };
}

/**
 * Core + halo + bounce. The old eye had one hard white dot at 0.97 alpha,
 * which is a sticker; a reflection on a wet sphere is a small blown core
 * inside a soft glow, with a dimmer, cooler second one low on the far side
 * where light comes back up off the substrate.
 */
function specularNodes(cx: number, cy: number, r: number, scale = 1): Node[] {
  const hx = cx - r * 0.33;
  const hy = cy - r * 0.37;
  return [
    {
      kind: "circle",
      cx: hx,
      cy: hy,
      r: r * 0.34 * scale,
      blur: r * 0.22,
      paint: { type: "solid", color: tinted(SPECULAR_TINT, 0.3) },
    },
    {
      kind: "circle",
      cx: hx,
      cy: hy,
      r: r * 0.17 * scale,
      paint: { type: "solid", color: tinted(SPECULAR_TINT, 0.97) },
    },
    {
      kind: "circle",
      cx: cx + r * 0.31,
      cy: cy + r * 0.35,
      r: r * 0.16 * scale,
      blur: r * 0.15,
      paint: { type: "solid", color: tinted(RIM_TINT, 0.36) },
    },
  ];
}

/** The opening's edge — a thin crease in the body's own keyline tone, not an ink ring. */
function rimNode(d: string, outlineColor: string, width = 1): Node {
  return {
    kind: "path",
    d,
    paint: { type: "solid", color: outlineColor, opacity: 0.45 },
    stroke: { width },
    blur: 0.35,
  };
}

/**
 * Shared skeleton: socket shadow, dark surround, graded iris, pupil, cornea,
 * speculars, rim. Every style is this with different proportions plus its own
 * extra feature, which is what keeps them recognisably the same animal.
 */
function eyeBase(opts: {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** Iris radius as a fraction of the opening. Near 1 — a fish's iris fills it. */
  irisFrac: number;
  /** Pupil radius as a fraction of the opening. */
  pupilFrac: number;
  outlineColor: string;
  irisColor: string;
  specScale?: number;
}): Node[] {
  const { cx, cy, rx, ry, irisFrac, pupilFrac, outlineColor, irisColor } = opts;
  const r = (rx + ry) / 2;
  const openingD = ellipseD(cx, cy, rx, ry);
  return [
    socketShadow(cx, cy, r, outlineColor),
    // The dark wet surround that shows at the edge — where a cartoon eye puts
    // its white sclera. Nothing on a real fish's eye is white.
    { kind: "path", d: openingD, paint: { type: "solid", color: SOCKET } },
    ...irisNodes(cx, cy, r * irisFrac, irisColor),
    pupilNode(cx, cy, r * pupilFrac),
    corneaNodes(cx, cy, r, openingD),
    ...specularNodes(cx, cy, r, opts.specScale),
    rimNode(openingD, outlineColor),
  ];
}

const classic: EyeStyleFn = ({ center, r, outlineColor, irisColor }) =>
  eyeBase({
    cx: center.x,
    cy: center.y,
    rx: r,
    ry: r,
    irisFrac: 0.95,
    pupilFrac: 0.66,
    outlineColor,
    irisColor,
  });

const ringed: EyeStyleFn = ({ center, r, outlineColor, irisColor }) => {
  const { x: cx, y: cy } = center;
  const base = irisTone(irisColor);
  const nodes = eyeBase({
    cx,
    cy,
    rx: r,
    ry: r,
    irisFrac: 0.96,
    pupilFrac: 0.72,
    outlineColor,
    irisColor,
  });
  // A bright metallic annulus hugging the pupil — the koi/molly look, where
  // the iris reads as a struck ring rather than a gradient. Inserted under
  // the cornea (index -4: cornea, 3 speculars, rim follow) so the wet sheen
  // still passes over it.
  nodes.splice(nodes.length - 5, 0, {
    kind: "path",
    d: ellipseD(cx, cy, r * 0.74, r * 0.74),
    paint: { type: "solid", color: warmLight(base, 0.55), opacity: 0.85 },
    stroke: { width: r * 0.17 },
    blur: 0.4,
  });
  return nodes;
};

const almond: EyeStyleFn = ({ center, r, outlineColor, irisColor }) => {
  const { x: cx, y: cy } = center;
  const rx = r * 1.16;
  const ry = r * 0.82;
  const nodes = eyeBase({
    cx,
    cy,
    rx,
    ry,
    irisFrac: 0.94,
    pupilFrac: 0.62,
    outlineColor,
    irisColor,
    specScale: 0.85,
  });
  // Upper lid line — a short heavier stroke over the top edge only, which is
  // what tips an ellipse from "eye shape" into "alert expression".
  nodes.push({
    kind: "path",
    d: `M ${f(cx - rx * 0.92)} ${f(cy - ry * 0.42)} Q ${f(cx)} ${f(cy - ry * 1.5)} ${f(cx + rx * 0.92)} ${f(cy - ry * 0.42)}`,
    paint: { type: "solid", color: outlineColor, opacity: 0.62 },
    stroke: { width: 1.4 },
    blur: 0.4,
  });
  return nodes;
};

const deep: EyeStyleFn = ({ center, r, outlineColor, irisColor }) =>
  // Pupil blown open, leaving only a thin coloured rim of iris — a fish in
  // low light. Reads best on the dark palettes (black, blackDiamond,
  // shadowVeil), which is where the seed lands it often enough.
  eyeBase({
    cx: center.x,
    cy: center.y,
    rx: r,
    ry: r,
    irisFrac: 0.97,
    pupilFrac: 0.82,
    outlineColor,
    irisColor,
    specScale: 1.15,
  });

const hooded: EyeStyleFn = ({ center, r, outlineColor, irisColor }) => {
  const { x: cx, y: cy } = center;
  const openingD = ellipseD(cx, cy, r, r);
  const nodes = eyeBase({
    cx,
    cy,
    rx: r,
    ry: r,
    irisFrac: 0.95,
    pupilFrac: 0.64,
    outlineColor,
    irisColor,
    specScale: 0.8,
  });
  // Lid — skin drawn over the top of the opening, clipped to it so it can be
  // authored as a simple slab instead of a fitted crescent. Sits under the
  // rim (last node) so the crease still closes the shape.
  //
  // The curve bottoms out at ~0.5r above centre, covering the top quarter.
  // An earlier version reached the centre line, which left a thin crescent
  // of iris under a huge lid and read as a WINK rather than a hooded eye —
  // very obvious on the light-irised varieties (sanke).
  nodes.splice(nodes.length - 1, 0, {
    kind: "path",
    d:
      `M ${f(cx - r * 1.3)} ${f(cy - r * 1.3)} L ${f(cx + r * 1.3)} ${f(cy - r * 1.3)} ` +
      `L ${f(cx + r * 1.3)} ${f(cy - r * 0.72)} Q ${f(cx)} ${f(cy - r * 0.28)} ${f(cx - r * 1.3)} ${f(cy - r * 0.72)} Z`,
    paint: { type: "solid", color: outlineColor, opacity: 0.94 },
    blur: 0.3,
    clip: openingD,
  });
  return nodes;
};

export const EYE_STYLES: Record<EyeStyleId, EyeStyleFn> = {
  classic,
  ringed,
  almond,
  deep,
  hooded,
};

/** Display order — drives `scripts/aquarium-preview.ts`'s eye grid. */
export const EYE_STYLE_IDS: readonly EyeStyleId[] = [
  "classic",
  "ringed",
  "almond",
  "deep",
  "hooded",
];

/**
 * Which style this individual fish gets.
 *
 * Keyed on `eye-<colorId>` rather than the pattern system's own
 * `pattern-<id>` deliberately: sharing the key would make eye choice a pure
 * function of pattern-variant choice, so the two axes would always vary
 * together instead of independently.
 *
 * `seed` is `FishTraits.patternSeed` — already part of `fishBakeKey`, so the
 * bake cache stays correct with no change there. Callers that omit it (the
 * in-session fish, tooling) fall to bucket 0 and get one stable style.
 */
export function eyeStyleFor(colorId: string, seed: number): EyeStyleId {
  const rng = makeRng(seededKey(`eye-${colorId}`, seed));
  return EYE_STYLE_IDS[Math.floor(rng() * EYE_STYLE_IDS.length)] ?? "classic";
}

export function eyeNodes(style: EyeStyleId, ctx: EyeContext): Node[] {
  return EYE_STYLES[style](ctx);
}
