// The volume toolkit: what turns a flat filled silhouette into something that
// reads as a solid object with a near side and a far side.
//
// `ribbon.ts` gives a shape and ONE gradient across its width. That is enough
// to say "this is curved" and not enough to say "this is a thing in space",
// and the gap was the whole difference between the generated scene and the
// painted sprite art it is modelled on (`assets/images/scene/*.png`). Reading
// those pieces, three things do that work and none of them existed here:
//
//   1. DEPTH ORDERING WITHIN A CLUMP. In `moss-ball.png` or `anubias-a.png`
//      the leaves at the back of the rosette are markedly darker than the
//      ones in front — not because they are differently coloured, but
//      because less light reaches them. A clump whose every element is the
//      same brightness reads as a decal no matter how well each element is
//      individually shaded.
//   2. A SPECULAR. Every wet leaf in that art carries a small hard bright
//      streak, well inside its silhouette, on the lit side. It is the single
//      cheapest cue that a surface is glossy and curved rather than matte
//      and flat.
//   3. CONTACT SHADOW. A dark pool where the piece meets the substrate.
//      Without it, everything hovers — `driftwood.ts` already had a private
//      version of this, which is why wood was the one species that looked
//      seated on the sand.
//
// Dependency-free (no React/RN/Skia) like the rest of `scene/gen/`.

import type { Node, XY } from "@/shared/aquarium/core/ir";
import { DEFAULT_SCENE_DESIGN } from "@/shared/aquarium/scene/scene-design";
import { darken } from "@/shared/lib/color";

import { ribbonCrossAxis, ribbonPath } from "./ribbon";

const LIGHT = DEFAULT_SCENE_DESIGN.lighting;

/**
 * How far the BACKMOST element of a clump is darkened relative to the front
 * one. Deliberately larger than `lighting.formDarken` (the across-a-single-
 * surface term): depth within a clump is a bigger effect than curvature
 * across one leaf, and under-doing it is what leaves a rosette looking like
 * stacked paper cutouts.
 */
export const DEPTH_DARKEN_MAX = 0.42;

/**
 * Tints `color` for an element sitting at `depth` through its own clump,
 * 0 = frontmost, 1 = backmost. Callers pass `i / (count - 1)` with their
 * elements emitted back-to-front, so painter's-order draw and the shading
 * agree.
 */
export function depthShade(color: string, depth: number): string {
  return darken(color, Math.max(0, Math.min(1, depth)) * DEPTH_DARKEN_MAX);
}

/**
 * A narrow bright streak running along the LIT side of a ribbon, inset from
 * its edge — the wet-leaf specular. Generalised from the private
 * `grainHighlight` in `driftwood.ts`, which was doing exactly this for bark
 * and was the only place in the tree that had it.
 *
 * `light` must be in the ribbon's OWN local space: a caller that authors a
 * leaf pointing up and rotates it into place has to pass
 * `lightInLocalSpace(...)`, for the same reason `ribbonCrossAxis` does — see
 * that function's doc.
 */
export function specularStreak(
  spine: readonly XY[],
  widthAt: (t: number) => number,
  light: XY,
  color: string,
  opacity = 0.34,
): Node {
  const cross = ribbonCrossAxis(spine, widthAt, light);
  const dx = cross.to.x - cross.from.x;
  const dy = cross.to.y - cross.from.y;
  const len = Math.hypot(dx, dy) || 1;
  // Offset toward the lit edge by ~40% of the half-width: far enough to read
  // as an edge highlight, still inside the silhouette so it never clips out.
  const offset = spine.map((p, i) => {
    const half = widthAt(i / Math.max(1, spine.length - 1)) / 2;
    return { x: p.x + (dx / len) * half * 0.4, y: p.y + (dy / len) * half * 0.4 };
  });
  return {
    kind: "path",
    // Fades in and out along the length rather than running the full span —
    // a streak that reaches both ends reads as a painted stripe, not a
    // glint. Peak around 45% up the blade.
    d: ribbonPath(offset, (t) => widthAt(t) * 0.22 * Math.sin(Math.min(1, t * 1.25) * Math.PI)),
    blend: "screen",
    paint: { type: "solid", color, opacity },
  };
}

/**
 * Soft dark elliptical pool at `cx` on the substrate line (y = 0).
 *
 * Flattened hard (ry ≈ 0.3 rx) because the tank is seen nearly side-on: a
 * round pool reads as a hole in the sand rather than as a shadow lying on it.
 */
export function contactShadow(cx: number, radius: number, strength = 0.3): Node {
  const ry = radius * 0.3;
  return {
    kind: "circle",
    cx,
    cy: 0,
    r: radius,
    blend: "multiply",
    paint: {
      type: "radial",
      center: { x: cx, y: 0 },
      radius,
      scale: { x: 1, y: ry / radius },
      stops: [
        { offset: 0, color: `rgba(0,0,0,${strength})` },
        { offset: 0.6, color: `rgba(0,0,0,${strength * 0.45})` },
        { offset: 1, color: "rgba(0,0,0,0)" },
      ],
    },
  };
}

/**
 * A soft warm glow set inside a blade's own silhouette — standing in for
 * light TRANSMITTED through thin, backlit tissue rather than bounced off it.
 *
 * `ribbonCrossAxis`/`ribbonFold` are both reflected-light models: brightest
 * where the surface normal points at the light. Transmission moves the
 * OPPOSITE way across a surface — a translucent leaf is brightest where it's
 * squarest-on to the light and thinnest, not at a grazing lit edge — so no
 * amount of tuning a reflected-light gradient can produce it. Real
 * underwater strap leaves are thin enough, and lit from close enough above,
 * that this is a large fraction of why they glow at all.
 *
 * Clipped to the caller's own silhouette `d` so it can be layered over
 * anything `ribbonPath`/`ribbonFold` produces without spilling past the
 * edge, unlike `specularStreak`, which is its own thin shape.
 */
export function translucency(
  clipD: string,
  spine: readonly XY[],
  widthAt: (t: number) => number,
  color: string,
  opacity = 0.22,
): Node {
  // Centred at 55% up the blade: young, thin tissue nearer the tip, not the
  // thicker base — and it keeps the glow off the crowded crown where several
  // leaves overlap and a bright patch there would read as a highlight on the
  // WRONG surface.
  const t = 0.55;
  const idx = Math.min(spine.length - 1, Math.round(t * (spine.length - 1)));
  const p = spine[idx];
  const half = widthAt(t) / 2;
  return {
    kind: "circle",
    cx: p.x,
    cy: p.y,
    r: half * 1.35,
    clip: clipD,
    blend: "plusLighter",
    blur: half * 0.55,
    paint: { type: "solid", color, opacity },
  };
}

/**
 * A dark inner edge hugging a silhouette — the line the painted art uses to
 * separate a piece from whatever sits behind it.
 *
 * A stroke rather than a second fill, and drawn at low opacity in the piece's
 * OWN dark tone rather than in black: a black outline reads as a sticker,
 * which is the failure mode this is meant to avoid, not cause.
 */
export function rimDarken(d: string, color: string, width: number, opacity = 0.5): Node {
  return {
    kind: "path",
    d,
    paint: { type: "solid", color: darken(color, 0.45), opacity },
    stroke: { width },
  };
}

/** The scene light as an {x,y} — every generator wants this and re-derived it by hand. */
export const LIGHT_DIR: XY = { x: LIGHT.dirX, y: LIGHT.dirY };
