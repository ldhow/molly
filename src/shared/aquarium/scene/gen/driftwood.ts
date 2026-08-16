// Driftwood (gỗ lũa): a seeded, recursively-branching piece of aquarium wood
// — a tapered trunk from the substrate plus 2-3 forking limbs, each exposing
// an anchor point near its tip so `anubias.ts` can mount naturally onto the
// wood instead of floating beside it.
//
// Local space: origin at the base (where it meets the substrate), x right,
// y NEGATIVE upward — matches `plants.tsx`'s existing convention.

import type { Node, XY } from "@/shared/aquarium/core/ir";
import { unionBox } from "@/shared/aquarium/core/ir";
import type { Anchor, Generator } from "@/shared/aquarium/scene/types";
import { makeRng } from "@/shared/lib/rng";

import { ribbonPath } from "./ribbon";

const BARK_DARK = "#2c1d14";
const BARK_MID = "#4a3220";

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
    angle += (rng() - 0.5) * 22; // organic wander, degrees per segment
    const rad = (angle * Math.PI) / 180;
    const step = (length / segments) * (0.85 + rng() * 0.3);
    pos = { x: pos.x + xSign * Math.cos(rad) * step, y: pos.y + Math.sin(rad) * step };
    spine.push(pos);
  }
  const d = ribbonPath(spine, (t) => baseWidth * Math.pow(1 - t, 0.7) + 0.6);
  return { spine, d };
}

function limbShading(d: string): Node {
  return {
    kind: "group",
    isolate: true,
    children: [
      { kind: "path", d, paint: { type: "solid", color: BARK_MID } },
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
        paint: { type: "solid", color: BARK_DARK, opacity: 0.4 },
        stroke: { width: 1.2 },
      },
    ],
  };
}

export const generateDriftwood: Generator = ({ seed, scale, mirror = false }) => {
  const rng = makeRng(`driftwood-${seed}`);
  const height = (150 + rng() * 90) * scale;
  const baseWidth = (15 + rng() * 7) * scale;
  const trunkHeading = -70 + (rng() - 0.5) * 30; // mostly upward; `mirror` flips which way it leans
  const trunk = limb(rng, { x: 0, y: 0 }, trunkHeading, height, baseWidth, 6, mirror);

  const nodes: Node[] = [limbShading(trunk.d)];
  const anchors: Anchor[] = [];
  let bbox = { x: -baseWidth, y: -height, width: baseWidth * 2, height };

  const branchCount = 2 + Math.floor(rng() * 2);
  for (let b = 0; b < branchCount; b++) {
    const forkT = 0.35 + rng() * 0.45;
    const forkIndex = Math.min(
      trunk.spine.length - 1,
      Math.round(forkT * (trunk.spine.length - 1)),
    );
    const forkPoint = trunk.spine[forkIndex];
    const forkHeading = trunkHeading + (rng() > 0.5 ? 1 : -1) * (35 + rng() * 35);
    const branchLen = height * (0.35 + rng() * 0.3);
    const branch = limb(rng, forkPoint, forkHeading, branchLen, baseWidth * 0.4, 4, mirror);
    nodes.push(limbShading(branch.d));
    const tip = branch.spine[branch.spine.length - 1];
    const prev = branch.spine[branch.spine.length - 2] ?? forkPoint;
    const outward = (Math.atan2(tip.y - prev.y, tip.x - prev.x) * 180) / Math.PI;
    anchors.push({ x: tip.x, y: tip.y, angleDeg: outward });
    bbox = unionBox(bbox, { x: tip.x - 4, y: tip.y - 4, width: 8, height: 8 });
  }
  // One anchor low on the trunk too, so anubias can sit at the base like it
  // often does in a real scape, not only on the high branches.
  const lowT = Math.min(trunk.spine.length - 1, Math.round(0.15 * (trunk.spine.length - 1)));
  anchors.push({ x: trunk.spine[lowT].x, y: trunk.spine[lowT].y, angleDeg: -100 - rng() * 40 });

  return { nodes, bbox, anchors, swayHeight: 0 }; // wood doesn't sway
};
