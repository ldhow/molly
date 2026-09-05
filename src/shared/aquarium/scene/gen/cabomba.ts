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

import { contactShadow, depthShade } from "./depth";
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
    // Scaled, so the silhouette is scale-invariant — see the identical note
    // in `plants.ts`'s `generateVallisneria` for why an unscaled lean turns a
    // large clump into a rigid picket fence.
    const lean =
      ((i - (stalkCount - 1) / 2) * DESIGN.leanBase + (rng() - 0.5) * DESIGN.leanJitter) * scale;
    const curve = (rng() - 0.5) * DESIGN.curveRange * scale;
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

    // Leaflets: sample the smoothed spine and put a WHORL at every other
    // station — a fan of needles on BOTH sides at once, not a single needle
    // alternating sides. Cabomba's whole read is feathery mass, and mass
    // needs overlapping fans: at one needle per station this drew a bare
    // stalk with a few specks attached, which is nothing like `cabomba.png`.
    const sampled = catmullRomSample(spine);
    let colorIdx = 0;
    for (let s = 3; s < sampled.length - 2; s += 2) {
      const p = sampled[s];
      const prev = sampled[Math.max(0, s - 1)];
      const next = sampled[Math.min(sampled.length - 1, s + 1)];
      const tangentDeg = (Math.atan2(next.y - prev.y, next.x - prev.x) * 180) / Math.PI;
      // Whorls shorten toward the growing tip, the way a real stem's newest
      // leaves haven't extended yet — this also stops the plant reading as a
      // uniform-width brush cut off at the top.
      const along = s / (sampled.length - 1);
      const taper = 0.55 + 0.45 * Math.sin(Math.min(1, along * 1.15) * Math.PI);
      const needleCount =
        DESIGN.whorlNeedleCountMin + Math.floor(rng() * DESIGN.whorlNeedleCountRange);

      for (const side of [-1, 1] as const) {
        for (let n = 0; n < needleCount; n++) {
          const fanT = needleCount === 1 ? 0.5 : n / (needleCount - 1);
          // Fan centred on the stalk normal, opening `whorlArcDeg` wide.
          const offsetDeg = (fanT - 0.5) * DESIGN.whorlArcDeg;
          const leafletLen =
            (DESIGN.leafletLenMin + rng() * DESIGN.leafletLenRange) * scale * taper;
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
                  (t) => 1.1 * scale * (1 - t * 0.55),
                ),
                paint: {
                  type: "solid",
                  // Needles at the OUTER edge of a fan point away from the
                  // viewer, so they take the depth tint; the ones nearest
                  // the fan's centre stay lit. Applied per-needle this is
                  // what turns a flat feather stencil into a bottlebrush
                  // with a near and a far side — see `depth.ts`.
                  color: depthShade(
                    LEAFLET_COLORS[colorIdx % LEAFLET_COLORS.length],
                    Math.abs(fanT - 0.5) * 1.5,
                  ),
                  opacity: 0.9,
                },
              },
            ],
            transform: {
              translateX: p.x,
              translateY: p.y,
              rotateDeg: tangentDeg + side * 90 + offsetDeg,
            },
          });
          colorIdx++;
        }
      }
    }

    bbox = unionBox(bbox, {
      x: baseX + lean + curve * 1.4 - height * 0.3,
      y: -height,
      width: height * 0.6,
      height,
    });
  }

  const clumpHalf = ((stalkCount - 1) / 2) * DESIGN.stalkSpacing * scale + 8 * scale;
  return {
    nodes: [contactShadow(0, clumpHalf * 1.6, 0.22), ...nodes],
    bbox,
    anchors: [],
    swayHeight: DESIGN.swayHeightFactor * scale,
  };
};
