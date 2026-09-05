// Driftwood (gỗ lũa): a seeded piece of aquarium wood — a main limb sweeping
// low and outward from the substrate, a flare of near-horizontal roots at its
// base, and branches forking off it, each exposing an anchor near its tip so
// `anubias.ts` can mount onto the wood instead of floating beside it.
//
// Local space: origin at the base (where it meets the substrate), x right,
// y NEGATIVE upward — matches `plants.ts`'s convention.
//
// Three things were rebuilt here, and reverting any of them re-breaks it:
//
//   1. THE BBOX IS COMPUTED, NOT GUESSED. It used to be
//      `{x: -baseWidth, y: -height, width: baseWidth*2, height}` — a guess
//      that only holds for a vertical trunk. `render/decor-cache.ts` bakes
//      into `inflateBox(bbox, 6)`, so every limb that leaned further than
//      `baseWidth` from the origin was rendering CLIPPED. Branch tips were
//      unioned in as bare 8x8 boxes, which rescued the tips and left the
//      limbs between them cut off. Any change to the silhouette has to keep
//      `limbBox` covering the real ribbon extent.
//
//   2. IT SPRAWLS INSTEAD OF STANDING UP. `headingBase` was -70 deg (near
//      vertical) with forking limbs, which reads as a bonsai, not as aquarium
//      wood. Real lũa lies low and wide across the substrate and meets the
//      sand at several points — hence the root flare and one contact shadow
//      per contact point, not one at the origin.
//
//   3. IT READS THE SCENE LIGHT. `limbShading` used hardcoded gradient
//      vectors ({0,0}->{8,8} and {-6,-6}->{2,2}) — absolute local offsets, so
//      on a 150px limb the whole gradient completed within the first 8px and
//      the rest was flat. Worse, it predated `DEFAULT_SCENE_DESIGN.lighting`
//      and so lit the wood from a different direction than every other
//      species. Form shading now goes through `ribbonCrossAxis`, ACROSS each
//      limb's width, on the shared scene light — see `gen/ribbon.ts`.

import type { Node, XY } from "@/shared/aquarium/core/ir";
import { unionBox } from "@/shared/aquarium/core/ir";
import { DEFAULT_SCENE_DESIGN } from "@/shared/aquarium/scene/scene-design";
import type { Anchor, Generator } from "@/shared/aquarium/scene/types";
import { darken, lighten } from "@/shared/lib/color";
import { makeRng } from "@/shared/lib/rng";

import { ribbonCrossAxis, ribbonPath } from "./ribbon";

const DESIGN = DEFAULT_SCENE_DESIGN.species.driftwood;
const LIGHT = DEFAULT_SCENE_DESIGN.lighting;

interface Limb {
  spine: XY[];
  d: string;
  widthAt: (t: number) => number;
  /** The ribbon's real extent — see rule 1 in this file's header. */
  box: { x: number; y: number; width: number; height: number };
}

/** Real bounds of a ribbon: every spine point inflated by the half-width there, plus a margin absorbing the Catmull-Rom overshoot `ribbonPath` smooths through. */
function limbBox(spine: readonly XY[], widthAt: (t: number) => number) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < spine.length; i++) {
    const half = widthAt(i / Math.max(1, spine.length - 1)) / 2 + 1.5;
    minX = Math.min(minX, spine[i].x - half);
    maxX = Math.max(maxX, spine[i].x + half);
    minY = Math.min(minY, spine[i].y - half);
    maxY = Math.max(maxY, spine[i].y + half);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function limb(
  rng: () => number,
  origin: XY,
  headingDeg: number,
  length: number,
  baseWidth: number,
  segments: number,
  mirror: boolean,
): Limb {
  const spine: XY[] = [origin];
  let angle = headingDeg;
  let pos = origin;
  // Flipping `dx`'s sign (not the heading algebra) mirrors the curve exactly
  // — same rng() sequence, same organic wander, same vertical profile, just
  // reflected — rather than trying to re-derive a mirrored heading and
  // getting a differently-shaped random walk out of the same seed.
  const xSign = mirror ? -1 : 1;
  for (let i = 1; i <= segments; i++) {
    angle += (rng() - 0.5) * DESIGN.wanderDeg; // organic wander, degrees per segment
    const rad = (angle * Math.PI) / 180;
    const step = (length / segments) * (0.85 + rng() * 0.3);
    pos = { x: pos.x + xSign * Math.cos(rad) * step, y: pos.y + Math.sin(rad) * step };
    spine.push(pos);
  }
  const widthAt = (t: number) => baseWidth * Math.pow(1 - t, 0.7) + 0.6;
  return { spine, d: ribbonPath(spine, widthAt), widthAt, box: limbBox(spine, widthAt) };
}

/**
 * Form shading ACROSS the limb's width on the shared scene light, plus a thin
 * dark keyline. One gradient is what turns a flat tapered ribbon into
 * something cylindrical — see `ribbonCrossAxis`'s doc for why the cross axis
 * is the right one and a base-to-tip gradient is nearly invisible.
 */
function limbShading(l: Limb, color: string): Node {
  const cross = ribbonCrossAxis(l.spine, l.widthAt, { x: LIGHT.dirX, y: LIGHT.dirY });
  return {
    kind: "group",
    isolate: true,
    children: [
      {
        kind: "path",
        d: l.d,
        paint: {
          type: "linear",
          from: cross.from,
          to: cross.to,
          // Base colour off-centre (0.62) so the shaded side occupies more of
          // the limb than the lit side — light falls off faster than it
          // builds, and an evenly split cylinder reads mechanical. Same split
          // `kelp.ts` uses, deliberately.
          stops: [
            { offset: 0, color: darken(color, LIGHT.formDarken) },
            { offset: 0.62, color },
            { offset: 1, color: lighten(color, LIGHT.formLighten) },
          ],
        },
      },
      {
        kind: "path",
        d: l.d,
        paint: { type: "solid", color: DESIGN.darkColor, opacity: 0.4 },
        stroke: { width: 1.2 },
      },
    ],
  };
}

/** A thin lengthwise grain streak offset toward the lit edge of the limb — real driftwood bark isn't a flat cylinder, light catches one ridge along its length. Offset along the cross axis (not blindly in x) so it stays on the lit side however the limb leans or mirrors. */
function grainHighlight(l: Limb): Node {
  const cross = ribbonCrossAxis(l.spine, l.widthAt, { x: LIGHT.dirX, y: LIGHT.dirY });
  const dx = cross.to.x - cross.from.x;
  const dy = cross.to.y - cross.from.y;
  const len = Math.hypot(dx, dy) || 1;
  const offsetSpine = l.spine.map((p, i) => {
    const half = l.widthAt(i / Math.max(1, l.spine.length - 1)) / 2;
    return { x: p.x + (dx / len) * half * 0.36, y: p.y + (dy / len) * half * 0.36 };
  });
  const d = ribbonPath(offsetSpine, (t) => l.widthAt(t) * 0.2 + 0.3);
  return {
    kind: "path",
    d,
    blend: "screen",
    paint: { type: "solid", color: DESIGN.highlightColor, opacity: 0.3 },
  };
}

/** Soft dark rings along a limb's interior — where a branch once was, real driftwood's "character". */
function knots(rng: () => number, spine: XY[], scale: number): Node[] {
  const count = DESIGN.knotCountMin + Math.floor(rng() * DESIGN.knotCountRange);
  const nodes: Node[] = [];
  for (let k = 0; k < count; k++) {
    // Interior of the limb only — a knot at the very tip or base reads wrong.
    const idx = 1 + Math.floor(rng() * Math.max(1, spine.length - 3));
    const p = spine[idx];
    const r = (DESIGN.knotRadiusMin + rng() * DESIGN.knotRadiusRange) * scale;
    nodes.push({
      kind: "circle",
      cx: p.x,
      cy: p.y,
      r,
      blend: "multiply",
      paint: {
        type: "radial",
        center: { x: p.x, y: p.y },
        radius: r,
        stops: [
          { offset: 0, color: "rgba(0,0,0,0.55)" },
          { offset: 0.7, color: "rgba(0,0,0,0.3)" },
          { offset: 1, color: "rgba(0,0,0,0)" },
        ],
      },
    });
  }
  return nodes;
}

/** Soft dark pool where wood meets the substrate — grounds the piece instead of it looking like it floats on the sand. One per contact point: a sprawling piece touches down in several places, and a single shadow at the origin leaves the root tips hovering. */
function contactShadow(cx: number, radius: number, strength: number): Node {
  const ry = radius * 0.35;
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
        { offset: 1, color: "rgba(0,0,0,0)" },
      ],
    },
  };
}

export const generateDriftwood: Generator = ({ seed, scale, mirror = false }) => {
  const rng = makeRng(`driftwood-${seed}`);
  const height = (DESIGN.heightMin + rng() * DESIGN.heightRange) * scale;
  const baseWidth = (DESIGN.baseWidthMin + rng() * DESIGN.baseWidthRange) * scale;
  // Mostly SIDEWAYS-and-up, not upright — see rule 2 in the header. `mirror`
  // flips which way it sweeps.
  const trunkHeading = DESIGN.headingBase + (rng() - 0.5) * DESIGN.headingRange;
  const trunk = limb(
    rng,
    { x: 0, y: 0 },
    trunkHeading,
    height,
    baseWidth,
    DESIGN.trunkSegments,
    mirror,
  );

  const midColor = DESIGN.midColor;
  const nodes: Node[] = [];
  // Tracked as geometry, not as built nodes, so the bbox can union the real
  // ellipses. Shadows multiply against the SAND, so they must all paint
  // before any wood — they're prepended at the end, not pushed inline.
  const contacts: { cx: number; radius: number; strength: number }[] = [];
  let bbox = trunk.box;

  // Root flare first, so it draws BEHIND the trunk that grows out of it.
  // Alternating sides: one family sweeps along +x, the other along -x (a
  // heading past 180 deg has a negative cosine), both rising slightly, so the
  // piece anchors into the sand from both directions instead of tipping.
  const rootCount = DESIGN.rootCountMin + Math.floor(rng() * DESIGN.rootCountRange);
  const roots: Limb[] = [];
  for (let r = 0; r < rootCount; r++) {
    const spread = DESIGN.rootHeadingBase + rng() * DESIGN.rootHeadingRange;
    const heading = r % 2 === 0 ? -spread : 180 + spread;
    const root = limb(
      rng,
      { x: 0, y: 0 },
      heading,
      height * (DESIGN.rootLenMin + rng() * DESIGN.rootLenRange),
      baseWidth * DESIGN.rootWidthFactor,
      DESIGN.rootSegments,
      mirror,
    );
    roots.push(root);
    // Roots sit low and in the substrate's shadow, so they read a shade
    // darker than the trunk they support.
    nodes.push(limbShading(root, darken(midColor, 0.18)));
    bbox = unionBox(bbox, root.box);
    // The tip x is already mirrored — `limb` applied `xSign` while walking
    // the spine — so the shadow lands under the root without a second flip.
    const tip = root.spine[root.spine.length - 1];
    contacts.push({
      cx: tip.x * 0.8,
      radius: baseWidth * DESIGN.contactShadowRadius * 0.7,
      strength: DESIGN.contactShadowStrength * 0.75,
    });
  }

  nodes.push(
    limbShading(trunk, midColor),
    grainHighlight(trunk),
    ...knots(rng, trunk.spine, scale),
  );
  contacts.push({
    cx: 0,
    radius: baseWidth * DESIGN.contactShadowRadius,
    strength: DESIGN.contactShadowStrength,
  });
  for (const c of contacts) {
    bbox = unionBox(bbox, {
      x: c.cx - c.radius,
      y: -c.radius * 0.35,
      width: c.radius * 2,
      height: c.radius * 0.35,
    });
  }

  const anchors: Anchor[] = [];
  const branchCount = DESIGN.branchCountMin + Math.floor(rng() * DESIGN.branchCountRange);
  for (let b = 0; b < branchCount; b++) {
    const forkT = DESIGN.forkTMin + rng() * DESIGN.forkTRange;
    const forkIndex = Math.min(
      trunk.spine.length - 1,
      Math.round(forkT * (trunk.spine.length - 1)),
    );
    const forkPoint = trunk.spine[forkIndex];
    const forkHeading =
      trunkHeading + (rng() > 0.5 ? 1 : -1) * (DESIGN.forkAngleMin + rng() * DESIGN.forkAngleRange);
    const branchLen = height * (DESIGN.branchLenMin + rng() * DESIGN.branchLenRange);
    const branch = limb(
      rng,
      forkPoint,
      forkHeading,
      branchLen,
      baseWidth * DESIGN.branchWidthFactor,
      DESIGN.branchSegments,
      mirror,
    );
    nodes.push(limbShading(branch, lighten(midColor, 0.06)), grainHighlight(branch));
    nodes.push(...knots(rng, branch.spine, scale));
    bbox = unionBox(bbox, branch.box);
    const tip = branch.spine[branch.spine.length - 1];
    const prev = branch.spine[branch.spine.length - 2] ?? forkPoint;
    const outward = (Math.atan2(tip.y - prev.y, tip.x - prev.x) * 180) / Math.PI;
    anchors.push({ x: tip.x, y: tip.y, angleDeg: outward });
  }
  // One anchor low on the trunk too, so anubias can sit at the base like it
  // often does in a real scape, not only on the high branches.
  const lowT = Math.min(
    trunk.spine.length - 1,
    Math.round(DESIGN.lowAnchorT * (trunk.spine.length - 1)),
  );
  anchors.push({
    x: trunk.spine[lowT].x,
    y: trunk.spine[lowT].y,
    angleDeg: DESIGN.lowAnchorAngleBase - rng() * DESIGN.lowAnchorAngleRange,
  });

  // Moss on the wood. Every driftwood piece in the sprite art carries it
  // (`driftwood-log.png` has a green mat along the log's upper surface), and
  // its absence was the last thing making generated wood read as a bare dead
  // twig rather than as something that has been underwater for years.
  //
  // Placed along the TRUNK's upper edge only: moss grows on the surfaces that
  // catch light and hold detritus, so a piece mossed evenly all round looks
  // dipped in paint instead of colonised.
  const MOSS_DARK = DEFAULT_SCENE_DESIGN.species.seiryuStone.mossDarkColor;
  const MOSS_MID = DEFAULT_SCENE_DESIGN.species.seiryuStone.mossMidColor;
  const MOSS_LIGHT = DEFAULT_SCENE_DESIGN.species.seiryuStone.mossLightColor;
  const mossNodes: Node[] = [];
  const trunkSmooth = trunk.spine;
  for (let i = 1; i < trunkSmooth.length - 1; i++) {
    if (rng() > 0.55) continue;
    const p = trunkSmooth[i];
    const half = trunk.widthAt(i / Math.max(1, trunkSmooth.length - 1)) / 2;
    const r = half * (0.55 + rng() * 0.5);
    // Sit the clump on the upper side of the limb (-y), which is where the
    // scene light comes from — see `scene-design.ts`'s `lighting`.
    const cx = p.x + (rng() - 0.5) * half * 0.6;
    const cy = p.y - half * 0.45;
    mossNodes.push({
      kind: "circle",
      cx,
      cy,
      r,
      paint: { type: "solid", color: MOSS_MID, opacity: 0.9 },
    });
    mossNodes.push({
      kind: "circle",
      cx: cx - r * 0.25,
      cy: cy - r * 0.28,
      r: r * 0.5,
      paint: { type: "solid", color: MOSS_LIGHT, opacity: 0.4 },
    });
    for (let g = 0; g < 4; g++) {
      const ga = rng() * Math.PI * 2;
      const gd = rng() * r * 0.85;
      mossNodes.push({
        kind: "circle",
        cx: cx + Math.cos(ga) * gd,
        cy: cy + Math.sin(ga) * gd * 0.7,
        r: r * (0.12 + rng() * 0.12),
        paint: {
          type: "solid",
          color: rng() > 0.5 ? MOSS_LIGHT : MOSS_DARK,
          opacity: 0.5,
        },
      });
    }
  }

  const shadows = contacts.map((c) => contactShadow(c.cx, c.radius, c.strength));
  return { nodes: [...shadows, ...nodes, ...mossNodes], bbox, anchors, swayHeight: 0 }; // wood doesn't sway
};
