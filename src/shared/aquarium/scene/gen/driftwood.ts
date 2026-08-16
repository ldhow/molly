// Driftwood (gỗ lũa): a seeded, recursively-branching piece of aquarium wood
// — a tapered trunk from the substrate plus 2-3 forking limbs, each exposing
// an anchor point near its tip so `anubias.ts` can mount naturally onto the
// wood instead of floating beside it.
//
// Local space: origin at the base (where it meets the substrate), x right,
// y NEGATIVE upward — matches `plants.tsx`'s existing convention.

import type { Node, XY } from "@/shared/aquarium/core/ir";
import { unionBox } from "@/shared/aquarium/core/ir";
import { DEFAULT_SCENE_DESIGN } from "@/shared/aquarium/scene/scene-design";
import type { Anchor, Generator } from "@/shared/aquarium/scene/types";
import { makeRng } from "@/shared/lib/rng";

import { ribbonPath } from "./ribbon";

const DESIGN = DEFAULT_SCENE_DESIGN.species.driftwood;

function limb(
  rng: () => number,
  origin: XY,
  headingDeg: number,
  length: number,
  baseWidth: number,
  segments: number,
  mirror: boolean,
): { spine: XY[]; d: string } {
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
  const d = ribbonPath(spine, (t) => baseWidth * Math.pow(1 - t, 0.7) + 0.6);
  return { spine, d };
}

/** A thin lengthwise grain streak offset toward one edge of the limb — real driftwood bark isn't a flat cylinder, light catches one ridge along its length. */
function grainHighlight(spine: XY[], baseWidth: number, xSign: number): Node {
  const offsetSpine = spine.map((p) => ({ x: p.x + xSign * baseWidth * 0.18, y: p.y }));
  const d = ribbonPath(offsetSpine, (t) => baseWidth * 0.1 * (1 - t * 0.5) + 0.3);
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

function limbShading(d: string): Node {
  return {
    kind: "group",
    isolate: true,
    children: [
      { kind: "path", d, paint: { type: "solid", color: DESIGN.midColor } },
      {
        kind: "path",
        d,
        blend: "multiply",
        paint: {
          type: "linear",
          from: { x: 0, y: 0 },
          to: { x: 8, y: 8 },
          stops: [
            { offset: 0, color: "rgba(0,0,0,0.35)" },
            { offset: 1, color: "rgba(0,0,0,0)" },
          ],
        },
      },
      {
        kind: "path",
        d,
        blend: "screen",
        paint: {
          type: "linear",
          from: { x: -6, y: -6 },
          to: { x: 2, y: 2 },
          stops: [
            { offset: 0, color: "rgba(255,255,255,0.16)" },
            { offset: 1, color: "rgba(255,255,255,0)" },
          ],
        },
      },
      {
        kind: "path",
        d,
        paint: { type: "solid", color: DESIGN.darkColor, opacity: 0.4 },
        stroke: { width: 1.2 },
      },
    ],
  };
}

/** Soft dark pool where the trunk meets the substrate — grounds the piece instead of it looking like it floats on the sand. */
function contactShadow(baseWidth: number): Node {
  const rx = baseWidth * DESIGN.contactShadowRadius;
  const ry = rx * 0.35;
  return {
    kind: "circle",
    cx: 0,
    cy: 0,
    r: rx,
    blend: "multiply",
    paint: {
      type: "radial",
      center: { x: 0, y: 0 },
      radius: rx,
      scale: { x: 1, y: ry / rx },
      stops: [
        { offset: 0, color: `rgba(0,0,0,${DESIGN.contactShadowStrength})` },
        { offset: 1, color: "rgba(0,0,0,0)" },
      ],
    },
  };
}

export const generateDriftwood: Generator = ({ seed, scale, mirror = false }) => {
  const rng = makeRng(`driftwood-${seed}`);
  const height = (DESIGN.heightMin + rng() * DESIGN.heightRange) * scale;
  const baseWidth = (DESIGN.baseWidthMin + rng() * DESIGN.baseWidthRange) * scale;
  const trunkHeading = DESIGN.headingBase + (rng() - 0.5) * DESIGN.headingRange; // mostly upward; `mirror` flips which way it leans
  const trunk = limb(
    rng,
    { x: 0, y: 0 },
    trunkHeading,
    height,
    baseWidth,
    DESIGN.trunkSegments,
    mirror,
  );

  const xSign = mirror ? -1 : 1;
  const nodes: Node[] = [
    contactShadow(baseWidth),
    limbShading(trunk.d),
    grainHighlight(trunk.spine, baseWidth, xSign),
    ...knots(rng, trunk.spine, scale),
  ];
  const anchors: Anchor[] = [];
  const shadowRx = baseWidth * DESIGN.contactShadowRadius;
  let bbox = unionBox(
    { x: -baseWidth, y: -height, width: baseWidth * 2, height },
    { x: -shadowRx, y: -shadowRx * 0.35, width: shadowRx * 2, height: shadowRx * 0.35 },
  );

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
    nodes.push(limbShading(branch.d), grainHighlight(branch.spine, baseWidth, xSign));
    nodes.push(...knots(rng, branch.spine, scale));
    const tip = branch.spine[branch.spine.length - 1];
    const prev = branch.spine[branch.spine.length - 2] ?? forkPoint;
    const outward = (Math.atan2(tip.y - prev.y, tip.x - prev.x) * 180) / Math.PI;
    anchors.push({ x: tip.x, y: tip.y, angleDeg: outward });
    bbox = unionBox(bbox, { x: tip.x - 4, y: tip.y - 4, width: 8, height: 8 });
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

  return { nodes, bbox, anchors, swayHeight: 0 }; // wood doesn't sway
};
