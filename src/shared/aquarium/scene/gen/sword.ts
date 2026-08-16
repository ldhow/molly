// Sword plant (cỏ lá hán): a bold mid-ground rosette — a handful of long,
// arching, lance-shaped leaves radiating from a low crown, always rooted in
// the substrate (never mounted, unlike `anubias`'s epiphyte leaves). Reads
// as a genuine centrepiece plant, not filler: roughly double `anubias`'s
// leaf reach, a narrower lance-blade ratio instead of a spade, and a
// brighter mid-tone for a bolder read. The fan stays closer to upright than
// anubias's — this species gets placed right at the swim-lane edge in
// `nature-scape.ts`, and leaves splayed much past ~35° off vertical reach
// sideways into the lane rather than up.
//
// Local space: origin at the crown (substrate line), +y down — same
// convention as the rest of the tree.

import type { Node, XY } from "@/shared/aquarium/core/ir";
import { unionBox } from "@/shared/aquarium/core/ir";
import { DEFAULT_SCENE_DESIGN } from "@/shared/aquarium/scene/scene-design";
import type { Generator } from "@/shared/aquarium/scene/types";
import { lighten } from "@/shared/lib/color";
import { makeRng } from "@/shared/lib/rng";

import { ribbonPath, spinePath } from "./ribbon";

const DESIGN = DEFAULT_SCENE_DESIGN.species.sword;

/** A long arching lance leaf: grows outward, then droops in its outer third — the silhouette a straight spade leaf (anubias.ts) doesn't have. */
function leafSpine(leafLen: number, rad: number, droop: number): XY[] {
  const dirX = Math.cos(rad);
  const dirY = Math.sin(rad);
  return [
    { x: 0, y: 0 },
    { x: dirX * leafLen * 0.4, y: dirY * leafLen * 0.4 },
    { x: dirX * leafLen * 0.85 + droop * 0.5, y: dirY * leafLen * 0.85 + droop * 0.3 },
    { x: dirX * leafLen + droop * 1.6, y: dirY * leafLen + droop },
  ];
}

export const generateSwordPlant: Generator = ({ seed, scale }) => {
  // Read at call time — see anubias.ts's identical note on why.
  const LEAF_DARK = DESIGN.leafDarkColor;
  const LEAF_MID = DESIGN.leafMidColor;
  const LEAF_TIP = lighten(LEAF_MID, DESIGN.leafTipLighten);
  const LEAF_VEIN = DESIGN.veinColor;
  const rng = makeRng(`sword-${seed}`);
  const leafCount = DESIGN.leafCountMin + Math.floor(rng() * DESIGN.leafCountRange);
  const nodes: Node[] = [
    { kind: "circle", cx: 0, cy: 0, r: 4 * scale, paint: { type: "solid", color: LEAF_DARK } },
  ];
  let bbox = { x: -6 * scale, y: -6 * scale, width: 12 * scale, height: 12 * scale };

  for (let i = 0; i < leafCount; i++) {
    const spread = (i - (leafCount - 1) / 2) * (DESIGN.spreadMin + rng() * DESIGN.spreadRange);
    const angleDeg = -90 + spread + (rng() - 0.5) * DESIGN.angleJitter;
    const rad = (angleDeg * Math.PI) / 180;
    const leafLen = (DESIGN.leafLenMin + rng() * DESIGN.leafLenRange) * scale;
    const leafWidth = leafLen * (DESIGN.leafWidthFactorMin + rng() * DESIGN.leafWidthFactorRange);
    const droop = (DESIGN.droopMin + rng() * DESIGN.droopRange) * scale;
    const spine = leafSpine(leafLen, rad, droop);
    const tip = spine[spine.length - 1];

    nodes.push({
      kind: "path",
      d: ribbonPath(
        spine,
        (t) => leafWidth * Math.sin(Math.min(1, t * 1.05) * Math.PI) * (1 - t * 0.1),
      ),
      paint: {
        type: "linear",
        from: { x: 0, y: 0 },
        to: tip,
        stops: [
          { offset: 0, color: LEAF_DARK },
          { offset: 0.6, color: LEAF_MID },
          { offset: 1, color: LEAF_TIP },
        ],
      },
    });
    nodes.push({
      kind: "path",
      d: spinePath(spine),
      paint: { type: "solid", color: LEAF_VEIN, opacity: 0.45 },
      stroke: { width: 1 * scale },
    });

    const reach = leafLen + leafWidth / 2;
    bbox = unionBox(bbox, {
      x: tip.x - reach,
      y: tip.y - reach,
      width: reach * 2,
      height: reach * 2,
    });
  }

  return { nodes, bbox, anchors: [], swayHeight: DESIGN.swayHeightFactor * scale };
};
