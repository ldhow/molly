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
import { DEFAULT_SCENE_DESIGN } from "@/shared/aquarium/scene/scene-design";
import type { Generator } from "@/shared/aquarium/scene/types";
import { lighten } from "@/shared/lib/color";
import { makeRng } from "@/shared/lib/rng";

import { ribbonPath } from "./ribbon";

const DESIGN = DEFAULT_SCENE_DESIGN.species.anubias;

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
  // Read at call time (not hoisted to module scope) so a live-edited colour
  // in `DEFAULT_SCENE_DESIGN` — e.g. from `yarn aquarium:design`'s Scene tab
  // — is picked up on the next bake, not frozen at import time.
  const LEAF_DARK = DESIGN.leafDarkColor;
  const LEAF_MID = DESIGN.leafMidColor;
  const LEAF_TIP = lighten(LEAF_MID, DESIGN.leafTipLighten);
  const LEAF_VEIN = DESIGN.veinColor;
  const rng = makeRng(`anubias-${seed}`);
  const baseAngle = attachTo ? attachTo.angleDeg : DESIGN.unattachedBaseAngle;
  const leafCount = DESIGN.leafCountMin + Math.floor(rng() * DESIGN.leafCountRange);
  const nodes: Node[] = [];
  let bbox = {
    x: -DESIGN.rhizomeSpan * scale,
    y: -DESIGN.rhizomeSpan * scale,
    width: DESIGN.rhizomeSpan * 2 * scale,
    height: DESIGN.rhizomeSpan * 2 * scale,
  };

  const rhizomeD = ribbonPath(
    [
      { x: -DESIGN.rhizomeSpan * scale, y: 0 },
      { x: DESIGN.rhizomeSpan * scale, y: -DESIGN.rhizomeTilt * scale },
    ],
    () => DESIGN.rhizomeWidth * scale,
  );
  nodes.push({
    kind: "path",
    d: rhizomeD,
    paint: { type: "solid", color: LEAF_VEIN, opacity: 0.85 },
  });

  for (let i = 0; i < leafCount; i++) {
    const spread = (i - (leafCount - 1) / 2) * (DESIGN.spreadBase + rng() * DESIGN.spreadRange);
    const angleDeg = baseAngle + spread + (rng() - 0.5) * DESIGN.angleJitter;
    const stemLen = (DESIGN.stemLenMin + rng() * DESIGN.stemLenRange) * scale;
    const leafLen = (DESIGN.leafLenMin + rng() * DESIGN.leafLenRange) * scale;
    const leafWidth = leafLen * (DESIGN.leafWidthFactorMin + rng() * DESIGN.leafWidthFactorRange);
    const rad = (angleDeg * Math.PI) / 180;

    const stemD = ribbonPath(
      [
        { x: 0, y: 0 },
        { x: Math.cos(rad) * stemLen, y: Math.sin(rad) * stemLen },
      ],
      () => DESIGN.stemWidth * scale,
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

  return { nodes, bbox, anchors: [], swayHeight: DESIGN.swayHeightFactor * scale };
};
