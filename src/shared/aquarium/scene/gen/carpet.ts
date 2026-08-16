// Monte-Carlo-style carpet plant: a low, dense ground-cover of tiny rounded
// leaf clumps hugging the substrate. Unlike every other front/mid species
// this one is deliberately short — see `CarpetDesign.heightMax`'s doc
// comment in scene-design.ts — so it reads as texture on the sand, not a
// silhouette competing with the taller plants for the "clear centre" and
// rule-of-thirds invariants `verify-aquarium.ts` enforces.
//
// Local space: origin at the base CENTER, +y down, clumps sitting just
// above y=0 — same convention as `substrate.ts`'s pebbles.

import type { Node, XY } from "@/shared/aquarium/core/ir";
import { unionBox } from "@/shared/aquarium/core/ir";
import { DEFAULT_SCENE_DESIGN } from "@/shared/aquarium/scene/scene-design";
import type { Generator } from "@/shared/aquarium/scene/types";
import { lighten } from "@/shared/lib/color";
import { makeRng } from "@/shared/lib/rng";

const DESIGN = DEFAULT_SCENE_DESIGN.species.carpet;

export const generateCarpet: Generator = ({ seed, scale }) => {
  // Read at call time — see anubias.ts's identical note on why.
  const LEAF_COLORS = [DESIGN.leafColor1, DESIGN.leafColor2, DESIGN.leafColor3];
  const rng = makeRng(`carpet-${seed}`);
  const clumpCount = DESIGN.clumpCountMin + Math.floor(rng() * DESIGN.clumpCountRange);
  const spread = (DESIGN.spreadMin + rng() * DESIGN.spreadRange) * scale;
  const nodes: Node[] = [];
  let bbox: { x: number; y: number; width: number; height: number } = {
    x: 0,
    y: -DESIGN.heightMax * scale,
    width: 1,
    height: DESIGN.heightMax * scale,
  };

  for (let c = 0; c < clumpCount; c++) {
    const cx = (rng() - 0.5) * spread;
    const clumpHeight = DESIGN.heightMax * scale * (0.55 + rng() * 0.45);
    const cy = -clumpHeight * (0.4 + rng() * 0.3);
    const r = (DESIGN.leafRadiusMin + rng() * DESIGN.leafRadiusRange) * scale;
    const color = LEAF_COLORS[c % LEAF_COLORS.length];
    const center: XY = { x: cx, y: cy };
    nodes.push({
      kind: "circle",
      cx: center.x,
      cy: center.y,
      r,
      paint: {
        type: "radial",
        center,
        radius: r,
        stops: [
          { offset: 0, color: lighten(color, 0.2) },
          { offset: 1, color },
        ],
      },
    });
    bbox = unionBox(bbox, { x: cx - r, y: cy - r, width: r * 2, height: r * 2 });
  }

  return { nodes, bbox, anchors: [], swayHeight: 0 };
};
