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

import { contactShadow, depthShade, specularStreak } from "./depth";
import { lightInLocalSpace, ribbonCrossAxis, ribbonPath } from "./ribbon";

const DESIGN = DEFAULT_SCENE_DESIGN.species.anubias;
const LIGHT = DEFAULT_SCENE_DESIGN.lighting;

/**
 * A spade/lance leaf blade, authored pointing straight up (-y) from its own
 * base. Returns the spine and width profile alongside the path because the
 * caller needs both to build the matching cross-axis form shading.
 */
function leafPath(
  len: number,
  width: number,
): { d: string; spine: XY[]; widthAt: (t: number) => number } {
  const spine: XY[] = [
    { x: 0, y: 0 },
    { x: width * 0.15, y: -len * 0.55 },
    { x: 0, y: -len },
  ];
  const widthAt = (t: number) => width * Math.sin(Math.min(1, t * 1.15) * Math.PI) * (1 - t * 0.15);
  return { d: ribbonPath(spine, widthAt), spine, widthAt };
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
    // Authored pointing up, then rotated by `angleDeg + 90` in the group
    // below — so the light must be counter-rotated into leaf space, or every
    // leaf in the rosette ends up lit from its own left and the plant reads
    // as having no light source at all.
    const leafCross = ribbonCrossAxis(
      leaf.spine,
      leaf.widthAt,
      lightInLocalSpace({ x: LIGHT.dirX, y: LIGHT.dirY }, angleDeg + 90),
    );
    // A rosette's outer leaves turn away from the viewer, so depth is
    // distance from the centre of the fan, not emit order. Without it every
    // leaf carried the same value and the plant read as a flat paper
    // cut-out — see `depth.ts`'s header for why this outweighs the
    // across-the-leaf gradient it sits on top of.
    const fromCentre =
      leafCount > 1 ? Math.abs(i - (leafCount - 1) / 2) / ((leafCount - 1) / 2) : 0;
    const depth = fromCentre * 0.85;
    const leafChildren: Node[] = [
      {
        kind: "path",
        d: leaf.d,
        paint: {
          type: "linear",
          from: leafCross.from,
          to: leafCross.to,
          stops: [
            { offset: 0, color: depthShade(LEAF_DARK, depth) },
            { offset: 0.6, color: depthShade(LEAF_MID, depth) },
            { offset: 1, color: depthShade(LEAF_TIP, depth) },
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
    // The broad glossy leaf is exactly the surface the sprite art gives its
    // hardest highlight to — `anubias-a.png` puts a bright blob on every
    // front leaf. Front leaves only, for the reason in `plants.ts`.
    if (depth < 0.5) {
      leafChildren.push(
        specularStreak(
          leaf.spine,
          leaf.widthAt,
          lightInLocalSpace({ x: LIGHT.dirX, y: LIGHT.dirY }, angleDeg + 90),
          lighten(LEAF_MID, 0.65),
          0.4 * (1 - depth * 2),
        ),
      );
    }
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

  return {
    // Only a PLANTED anubias gets a ground shadow. An `attachTo` piece is
    // mounted partway up driftwood with open water beneath it, where a pool
    // of shadow at its own origin would be a dark smear floating in midwater.
    nodes: attachTo ? nodes : [contactShadow(0, DESIGN.rhizomeSpan * 2.6 * scale, 0.24), ...nodes],
    bbox,
    anchors: [],
    swayHeight: DESIGN.swayHeightFactor * scale,
  };
};
