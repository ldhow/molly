// Cabomba (rong đuôi chồn): a feathery back-layer stem plant — a thin bare
// stalk carrying tiny paired needle-leaflets in whorls along its length.
// Shares the back-layer grass line with `vallisneria` (a plain thin blade)
// and `kelp` (a broad dark silhouette frond) but reads as neither: a fine,
// textured stalk distinct from both at a glance.
//
// Local space: origin at the base, +y down, stalk growing to -y — same
// convention as every other back-layer generator in this tree.

import type { Node, XY } from "@/shared/aquarium/core/ir";
import { unionBox } from "@/shared/aquarium/core/ir";
import { DEFAULT_SCENE_DESIGN } from "@/shared/aquarium/scene/scene-design";
import type { Generator } from "@/shared/aquarium/scene/types";
import { makeRng } from "@/shared/lib/rng";

import { catmullRomSample, ribbonPath } from "./ribbon";

const DESIGN = DEFAULT_SCENE_DESIGN.species.cabomba;

export const generateCabomba: Generator = ({ seed, scale }) => {
  // Read at call time — see anubias.ts's identical note on why.
  const STALK_COLOR = DESIGN.stalkColor;
  const LEAFLET_COLORS = [DESIGN.leafletColor1, DESIGN.leafletColor2, DESIGN.leafletColor3];
  const rng = makeRng(`cabomba-${seed}`);
  const stalkCount = DESIGN.stalkCountMin + Math.floor(rng() * DESIGN.stalkCountRange);
  const nodes: Node[] = [];
  let bbox = { x: 0, y: 0, width: 1, height: 1 };

  for (let i = 0; i < stalkCount; i++) {
    const height = (DESIGN.heightMin + rng() * DESIGN.heightRange) * scale;
    const lean = (i - (stalkCount - 1) / 2) * DESIGN.leanBase + (rng() - 0.5) * DESIGN.leanJitter;
    const curve = (rng() - 0.5) * DESIGN.curveRange;
    const baseX = (i - (stalkCount - 1) / 2) * DESIGN.stalkSpacing * scale;
    const spine: XY[] = [
      { x: baseX, y: 0 },
      { x: baseX + lean, y: -height * 0.4 },
      { x: baseX + lean + curve, y: -height * 0.8 },
      { x: baseX + lean + curve * 1.4, y: -height },
    ];
    const stalkWidth = (DESIGN.stalkWidthMin + rng() * DESIGN.stalkWidthRange) * scale;
    nodes.push({
      kind: "path",
      d: ribbonPath(spine, (t) => stalkWidth * (1 - t * 0.4)),
      paint: { type: "solid", color: STALK_COLOR, opacity: 0.85 },
    });

    // Leaflets: sample the smoothed spine and drop a tiny needle pair at
    // every 2nd-3rd station, alternating sides — a "whorl" without actually
    // modelling radial symmetry, which is invisible at this scale anyway.
    const sampled = catmullRomSample(spine);
    let side = 1;
    let colorIdx = 0;
    for (let s = 4; s < sampled.length - 2; s += 2 + Math.floor(rng() * 2)) {
      const p = sampled[s];
      const prev = sampled[Math.max(0, s - 1)];
      const next = sampled[Math.min(sampled.length - 1, s + 1)];
      const tangentDeg = (Math.atan2(next.y - prev.y, next.x - prev.x) * 180) / Math.PI;
      const leafletLen = (DESIGN.leafletLenMin + rng() * DESIGN.leafletLenRange) * scale;
      nodes.push({
        kind: "group",
        children: [
          {
            kind: "path",
            d: ribbonPath(
              [
                { x: 0, y: 0 },
                { x: leafletLen, y: 0 },
              ],
              (t) => 1.1 * scale * (1 - t * 0.5),
            ),
            paint: {
              type: "solid",
              color: LEAFLET_COLORS[colorIdx % LEAFLET_COLORS.length],
              opacity: 0.9,
            },
          },
        ],
        transform: {
          translateX: p.x,
          translateY: p.y,
          rotateDeg: tangentDeg + side * (45 + rng() * 20),
        },
      });
      side *= -1;
      colorIdx++;
    }

    bbox = unionBox(bbox, {
      x: baseX + lean + curve * 1.4 - height * 0.3,
      y: -height,
      width: height * 0.6,
      height,
    });
  }

  return { nodes, bbox, anchors: [], swayHeight: DESIGN.swayHeightFactor * scale };
};
