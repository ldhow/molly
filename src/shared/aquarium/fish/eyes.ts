// The fish's eye, as a small set of authored styles.
//
// This used to be one hardcoded block in `bake-fish.ts` — the identical
// sclera/ring/pupil/catchlight on all 16 colours x ~480 trait combinations.
// Two things changed:
//
// 1. Every style now draws an IRIS between the sclera and the pupil. Its
//    absence is the main reason the old eye read as a painted dot rather
//    than an eye: a real eye's structure is sclera -> iris -> pupil, and the
//    iris is the ring that carries colour and catches light.
// 2. Which style an individual fish gets is picked deterministically from
//    its own pattern seed (see `eyeStyleFor`), so a tank reads as a group of
//    individuals instead of one fish recoloured N times.
//
// What deliberately did NOT change: the bold-keyline ring and the specular
// catchlight. Per `src/docs/aquarium-guide.md`'s art-direction section, the
// "bold illustrated mascot" surface treatment IS this renderer's visual
// identity, and realism here has to come from adding missing STRUCTURE, not
// from softening that treatment back toward the painterly pass it replaced.
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
import { darken, lighten, relativeLuminance } from "@/shared/lib/color";
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

const SCLERA = "#f8f5ee";
const PUPIL = "#0b0e14";
const RING = "#12161f";
const CATCHLIGHT = "#f9fcff";

/** A closed ellipse as a path `d` — the IR has a `circle` node but no ellipse. */
function ellipseD(cx: number, cy: number, rx: number, ry: number): string {
  return (
    `M ${f(cx - rx)} ${f(cy)} ` +
    `a ${f(rx)} ${f(ry)} 0 1 0 ${f(rx * 2)} 0 ` +
    `a ${f(rx)} ${f(ry)} 0 1 0 ${f(-rx * 2)} 0 Z`
  );
}

/**
 * Conditions a palette colour into an iris tint that still separates from
 * the near-black pupil.
 *
 * Raw `palette.fin` is the right hue — it's what ties the eye to the variety
 * — but many varieties have near-black fins (goldDust, black, chocolate), and
 * on those an unconditioned iris merges into the pupil and reads as one
 * oversized dot. That loses precisely the structure this module adds. Dark
 * tints are lifted toward mid; anything already light passes through
 * untouched, so bright varieties keep their exact palette colour.
 */
function irisTone(hex: string): string {
  const lift = Math.max(0, 0.62 - relativeLuminance(hex) * 2.4);
  return lift > 0 ? lighten(hex, lift) : hex;
}

/** The bold keyline rim every style shares — stroked, so it reads as drawn ink. */
function rim(d: string, width: number): Node {
  return {
    kind: "path",
    d,
    paint: { type: "solid", color: RING, opacity: 0.95 },
    stroke: { width },
  };
}

/** The specular dot. Offset up-and-forward, matching `bake-fish.ts`'s `LIGHT_DIR`. */
function catchlight(cx: number, cy: number, r: number, opacity = 0.97): Node {
  return {
    kind: "circle",
    cx,
    cy,
    r,
    paint: { type: "solid", color: CATCHLIGHT, opacity },
  };
}

const classic: EyeStyleFn = ({ center, r, irisColor }) => {
  const { x: cx, y: cy } = center;
  return [
    { kind: "circle", cx, cy, r, paint: { type: "solid", color: SCLERA } },
    {
      kind: "circle",
      cx,
      cy,
      r: r * 0.78,
      paint: { type: "solid", color: irisTone(irisColor), opacity: 0.92 },
    },
    // A darker outer edge on the iris — a flat disc of colour still reads
    // flat; the graded rim is what gives it the wet, domed look.
    {
      kind: "circle",
      cx,
      cy,
      r: r * 0.78,
      paint: {
        type: "radial",
        center: { x: cx, y: cy },
        radius: r * 0.78,
        stops: [
          { offset: 0.45, color: "rgba(0,0,0,0)" },
          { offset: 1, color: "rgba(0,0,0,0.45)" },
        ],
      },
    },
    { kind: "circle", cx, cy, r: r * 0.55, paint: { type: "solid", color: PUPIL } },
    rim(ellipseD(cx, cy, r, r), 1.7),
    catchlight(cx - r * 0.27, cy - r * 0.3, r * 0.27),
  ];
};

const ringed: EyeStyleFn = ({ center, r, irisColor }) => {
  const { x: cx, y: cy } = center;
  const iris = r * 0.86;
  return [
    { kind: "circle", cx, cy, r, paint: { type: "solid", color: SCLERA } },
    {
      kind: "circle",
      cx,
      cy,
      r: iris,
      paint: { type: "solid", color: lighten(irisColor, 0.45) },
    },
    // The bright annulus itself — a metallic iris ring around a wide pupil
    // is what a real molly's (and a koi's) eye actually looks like.
    {
      kind: "path",
      d: ellipseD(cx, cy, iris * 0.85, iris * 0.85),
      paint: { type: "solid", color: lighten(irisColor, 0.72), opacity: 0.9 },
      stroke: { width: r * 0.16 },
    },
    { kind: "circle", cx, cy, r: r * 0.62, paint: { type: "solid", color: PUPIL } },
    rim(ellipseD(cx, cy, r, r), 1.7),
    catchlight(cx - r * 0.28, cy - r * 0.32, r * 0.26),
    catchlight(cx + r * 0.3, cy + r * 0.28, r * 0.11, 0.6),
  ];
};

const almond: EyeStyleFn = ({ center, r, outlineColor, irisColor }) => {
  const { x: cx, y: cy } = center;
  const rx = r * 1.16;
  const ry = r * 0.82;
  const scleraD = ellipseD(cx, cy, rx, ry);
  return [
    { kind: "path", d: scleraD, paint: { type: "solid", color: SCLERA } },
    {
      kind: "path",
      d: ellipseD(cx, cy, rx * 0.66, ry * 0.86),
      paint: { type: "solid", color: irisTone(irisColor), opacity: 0.92 },
    },
    { kind: "circle", cx, cy, r: r * 0.42, paint: { type: "solid", color: PUPIL } },
    rim(scleraD, 1.6),
    // Upper lid line — a short heavier stroke over the top edge only, which
    // is what tips an ellipse from "eye shape" into "alert expression".
    {
      kind: "path",
      d: `M ${f(cx - rx * 0.92)} ${f(cy - ry * 0.42)} Q ${f(cx)} ${f(cy - ry * 1.5)} ${f(cx + rx * 0.92)} ${f(cy - ry * 0.42)}`,
      paint: { type: "solid", color: darken(outlineColor, 0.2), opacity: 0.9 },
      stroke: { width: 1.8 },
    },
    catchlight(cx - rx * 0.3, cy - ry * 0.34, r * 0.22),
  ];
};

const deep: EyeStyleFn = ({ center, r, irisColor }) => {
  const { x: cx, y: cy } = center;
  return [
    { kind: "circle", cx, cy, r, paint: { type: "solid", color: SCLERA } },
    // Iris fills almost the whole eye and the pupil fills most of the iris,
    // leaving only a thin coloured rim — the blown-open look of a fish in
    // low light. Reads best on the dark palettes (black, blackDiamond,
    // shadowVeil), which is where the seed will land it often enough.
    { kind: "circle", cx, cy, r: r * 0.92, paint: { type: "solid", color: irisTone(irisColor) } },
    {
      kind: "circle",
      cx,
      cy,
      r: r * 0.92,
      paint: {
        type: "radial",
        center: { x: cx - r * 0.25, y: cy - r * 0.28 },
        radius: r * 1.1,
        stops: [
          { offset: 0, color: "rgba(255,255,255,0.3)" },
          { offset: 0.6, color: "rgba(255,255,255,0)" },
          { offset: 1, color: "rgba(0,0,0,0.35)" },
        ],
      },
    },
    { kind: "circle", cx, cy, r: r * 0.72, paint: { type: "solid", color: PUPIL } },
    rim(ellipseD(cx, cy, r, r), 1.7),
    catchlight(cx - r * 0.3, cy - r * 0.33, r * 0.32),
    catchlight(cx + r * 0.26, cy + r * 0.3, r * 0.13, 0.65),
  ];
};

const hooded: EyeStyleFn = ({ center, r, outlineColor, irisColor }) => {
  const { x: cx, y: cy } = center;
  const scleraD = ellipseD(cx, cy, r, r);
  return [
    { kind: "circle", cx, cy, r, paint: { type: "solid", color: SCLERA } },
    {
      kind: "circle",
      cx,
      cy,
      r: r * 0.76,
      paint: { type: "solid", color: irisTone(irisColor), opacity: 0.92 },
    },
    { kind: "circle", cx, cy, r: r * 0.48, paint: { type: "solid", color: PUPIL } },
    // Lid — skin drawn OVER the top third of the eye, clipped to the sclera
    // so it can be authored as a simple slab instead of a fitted crescent.
    {
      kind: "path",
      d:
        `M ${f(cx - r * 1.3)} ${f(cy - r * 1.3)} L ${f(cx + r * 1.3)} ${f(cy - r * 1.3)} ` +
        `L ${f(cx + r * 1.3)} ${f(cy - r * 0.34)} Q ${f(cx)} ${f(cy + r * 0.2)} ${f(cx - r * 1.3)} ${f(cy - r * 0.34)} Z`,
      paint: { type: "solid", color: outlineColor, opacity: 0.94 },
      clip: scleraD,
    },
    rim(scleraD, 1.7),
    catchlight(cx - r * 0.24, cy + r * 0.16, r * 0.2, 0.85),
  ];
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
