// A small flowering accent: a low cluster of short stems, each topped with a
// soft pink/violet pom-pom bloom. Purely a colour accent — the reference
// background's warm pink/purple flowers are what stop an all-teal underwater
// scene reading as monochrome, and a couple of small saturated spots do that
// far more efficiently than recolouring the foliage.
//
// Kept deliberately SMALL and placed at the bottom corners: this is a punctuation
// mark in the composition, not a mass. Growing it would fight the "clear centre"
// and left/right-asymmetry invariants `verify-aquarium.ts` enforces.
//
// Local space: origin at the base, +y down, stems growing to -y.

import type { Node, XY } from "@/shared/aquarium/core/ir";
import { unionBox } from "@/shared/aquarium/core/ir";
import type { Generator } from "@/shared/aquarium/scene/types";
import { lighten } from "@/shared/lib/color";
import { makeRng } from "@/shared/lib/rng";

import { ribbonPath } from "./ribbon";

const PETAL_COLORS = ["#d98ac4", "#c377d8", "#e79ec6"];
const STEM_COLOR = "#2f6b4a";

export const generateBloom: Generator = ({ seed, scale }) => {
  const rng = makeRng(`bloom-${seed}`);
  const stemCount = 3 + Math.floor(rng() * 3);
  const nodes: Node[] = [];
  let bbox = { x: -4 * scale, y: -4 * scale, width: 8 * scale, height: 8 * scale };

  for (let i = 0; i < stemCount; i++) {
    const angleDeg = -90 + (i - (stemCount - 1) / 2) * (15 + rng() * 9);
    const rad = (angleDeg * Math.PI) / 180;
    const stemLen = (16 + rng() * 16) * scale;
    const tipX = Math.cos(rad) * stemLen;
    const tipY = Math.sin(rad) * stemLen;

    nodes.push({
      kind: "path",
      d: ribbonPath(
        [
          { x: 0, y: 0 },
          { x: tipX, y: tipY },
        ],
        () => 1.1 * scale,
      ),
      paint: { type: "solid", color: STEM_COLOR, opacity: 0.85 },
    });

    // The bloom: a ring of small soft petals around a lighter centre. Drawn
    // as plain circles rather than shaped petals — at this size (a few px)
    // petal geometry is invisible and only costs path nodes.
    const petalColor = PETAL_COLORS[i % PETAL_COLORS.length];
    const r = (3.4 + rng() * 1.6) * scale;
    const petals = 5;
    const rot = rng() * Math.PI * 2;
    for (let k = 0; k < petals; k++) {
      const a = rot + (k / petals) * Math.PI * 2;
      const p: XY = { x: tipX + Math.cos(a) * r * 0.72, y: tipY + Math.sin(a) * r * 0.72 };
      nodes.push({
        kind: "circle",
        cx: p.x,
        cy: p.y,
        r: r * 0.62,
        paint: { type: "solid", color: petalColor, opacity: 0.92 },
        blur: 0.35,
      });
    }
    nodes.push({
      kind: "circle",
      cx: tipX,
      cy: tipY,
      r: r * 0.45,
      paint: { type: "solid", color: lighten(petalColor, 0.45), opacity: 0.95 },
    });

    const reach = stemLen + r * 2;
    bbox = unionBox(bbox, {
      x: tipX - reach * 0.5,
      y: tipY - r * 2,
      width: reach,
      height: r * 4,
    });
  }

  return { nodes, bbox, anchors: [], swayHeight: 14 * scale };
};
