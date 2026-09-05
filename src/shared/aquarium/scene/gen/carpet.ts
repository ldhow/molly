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
import { darken, lighten } from "@/shared/lib/color";
import { makeRng } from "@/shared/lib/rng";

import { contactShadow, depthShade } from "./depth";

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
    // Clumps toward the EDGES of the spread are the sides of the mound
    // turning away; the middle ones face the viewer. Without this the carpet
    // was a scatter of identical flat dots — see `depth.ts`.
    const fromCentre = spread > 0 ? Math.min(1, Math.abs(cx) / (spread / 2)) : 0;
    const depth = fromCentre * 0.8;
    const color = depthShade(LEAF_COLORS[c % LEAF_COLORS.length], depth);
    const center: XY = { x: cx, y: cy };
    nodes.push({
      kind: "circle",
      cx: center.x,
      cy: center.y,
      r,
      paint: {
        type: "radial",
        // Off-centre toward the light, so each clump is a little SPHERE
        // rather than a disc with a bullseye — a centred radial gradient is
        // the classic tell of generated art.
        center: { x: center.x - r * 0.3, y: center.y - r * 0.32 },
        radius: r * 1.15,
        stops: [
          { offset: 0, color: lighten(color, 0.28) },
          { offset: 0.55, color },
          { offset: 1, color: darken(color, 0.3) },
        ],
      },
    });
    // A few individual leaflets breaking the clump's outline. A carpet plant
    // is many tiny leaves, and a perfectly round edge is what made these read
    // as bubbles rather than as foliage.
    const leafletCount = 3 + Math.floor(rng() * 3);
    for (let l = 0; l < leafletCount; l++) {
      const a = rng() * Math.PI * 2;
      nodes.push({
        kind: "circle",
        cx: center.x + Math.cos(a) * r * 0.8,
        cy: center.y + Math.sin(a) * r * 0.7,
        r: r * (0.3 + rng() * 0.22),
        paint: {
          type: "solid",
          color: rng() > 0.45 ? lighten(color, 0.15) : darken(color, 0.15),
          opacity: 0.95,
        },
      });
    }
    bbox = unionBox(bbox, { x: cx - r * 1.4, y: cy - r * 1.4, width: r * 2.8, height: r * 2.8 });
  }

  return {
    nodes: [contactShadow(0, spread * 0.7, 0.2), ...nodes],
    bbox,
    anchors: [],
    swayHeight: 0,
  };
};
