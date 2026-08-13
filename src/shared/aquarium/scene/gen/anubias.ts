// Anubias (cây ráy): a short rhizome with several spade-shaped leaves on
// wiry stems. Grows either straight from the substrate (`attachTo` absent)
// or mounted onto a driftwood anchor — the epiphyte look real anubias is
// usually kept in, tied to wood rather than planted in substrate.
//
// Local space: origin at the rhizome (the substrate or the driftwood
// anchor), +y down (matches the rest of the tree). Each leaf is authored
// pointing straight up from its own stem tip, then placed with a `group`
// transform — see `core/ir.ts`'s `GroupTransform` — instead of hand-rotating
// path coordinates.

import type { Node, XY } from "@/shared/aquarium/core/ir";
import { unionBox } from "@/shared/aquarium/core/ir";
import type { Generator } from "@/shared/aquarium/scene/types";
import { lighten } from "@/shared/lib/color";
import { makeRng } from "@/shared/lib/rng";

import { ribbonPath } from "./ribbon";

const LEAF_DARK = "#175c3d";
const LEAF_MID = "#2f8f5b";
const LEAF_TIP = lighten(LEAF_MID, 0.2);
const LEAF_VEIN = "#0d3322";

/** A spade/lance leaf blade, authored pointing straight up (-y) from its own base. */
function leafPath(len: number, width: number): string {
  const spine: XY[] = [
    { x: 0, y: 0 },
    { x: width * 0.15, y: -len * 0.55 },
    { x: 0, y: -len },
  ];
  return ribbonPath(
    spine,
    (t) => width * Math.sin(Math.min(1, t * 1.15) * Math.PI) * (1 - t * 0.15),
  );
}

export const generateAnubias: Generator = ({ seed, scale, attachTo }) => {
  const rng = makeRng(`anubias-${seed}`);
  const baseAngle = attachTo ? attachTo.angleDeg : -90;
  const leafCount = 3 + Math.floor(rng() * 3);
  const nodes: Node[] = [];
  let bbox = { x: -6 * scale, y: -6 * scale, width: 12 * scale, height: 12 * scale };

  const rhizomeD = ribbonPath(
    [
      { x: -6 * scale, y: 0 },
      { x: 6 * scale, y: -1 * scale },
    ],
    () => 4 * scale,
  );
  nodes.push({
    kind: "path",
    d: rhizomeD,
    paint: { type: "solid", color: LEAF_VEIN, opacity: 0.85 },
  });

  for (let i = 0; i < leafCount; i++) {
    const spread = (i - (leafCount - 1) / 2) * (18 + rng() * 8);
    const angleDeg = baseAngle + spread + (rng() - 0.5) * 10;
    const stemLen = (10 + rng() * 6) * scale;
    const leafLen = (30 + rng() * 22) * scale;
    const leafWidth = leafLen * (0.42 + rng() * 0.12);
    const rad = (angleDeg * Math.PI) / 180;

    const stemD = ribbonPath(
      [
        { x: 0, y: 0 },
        { x: Math.cos(rad) * stemLen, y: Math.sin(rad) * stemLen },
      ],
      () => 1.4 * scale,
    );
    nodes.push({
      kind: "path",
      d: stemD,
      paint: { type: "solid", color: LEAF_VEIN, opacity: 0.7 },
    });

    const tipX = Math.cos(rad) * stemLen;
    const tipY = Math.sin(rad) * stemLen;
    const leaf = leafPath(leafLen, leafWidth);
    const leafChildren: Node[] = [
      {
        kind: "path",
        d: leaf,
        paint: {
          type: "linear",
          from: { x: 0, y: 0 },
          to: { x: 0, y: -leafLen },
          stops: [
            { offset: 0, color: LEAF_DARK },
            { offset: 0.6, color: LEAF_MID },
            { offset: 1, color: LEAF_TIP },
          ],
        },
      },
      {
        kind: "path",
        d: `M 0 0 L 0 ${(-leafLen * 0.92).toFixed(1)}`,
        paint: { type: "solid", color: LEAF_VEIN, opacity: 0.5 },
        stroke: { width: 0.8 * scale },
      },
    ];
    // The leaf continues the stem's outward lean (angleDeg), authored
    // pointing up (-y = angleDeg 0 in this rotation's terms), so rotate by
    // `angleDeg + 90` to align "up" with the stem's own direction.
    nodes.push({
      kind: "group",
      children: leafChildren,
      transform: { translateX: tipX, translateY: tipY, rotateDeg: angleDeg + 90 },
    });

    // Rough bbox for a leaf pointing outward by angleDeg, length leafLen,
    // width leafWidth — inflate a circle of that radius around the tip,
    // which safely bounds the actual rotated rectangle without doing the
    // full trig (this is only used for layout/composition, not clipping).
    const reach = leafLen + leafWidth / 2;
    bbox = unionBox(bbox, {
      x: tipX - reach,
      y: tipY - reach,
      width: reach * 2,
      height: reach * 2,
    });
  }

  return { nodes, bbox, anchors: [], swayHeight: 14 * scale };
};
