// Ground-cover decor: two species that dress the substrate line itself
// rather than growing up from it.
//
// - substrateMound: a wide, low rise in the sand — real scapes slope the
//   substrate up at the back and sides (aquascaping "hardscape" convention);
//   a perfectly flat sand band read as the least real-tank thing in the
//   scene. Smooth and rounded, not jagged like `rock.ts`'s stone — it's
//   sand, not rock.
// - pebbles: a small scatter of rounded stones at the front, breaking up
//   the substrate/glass seam a single flat sand edge leaves visible.
//
// Local space for both: origin at the base CENTER (bottom edge on y=0),
// extending upward (-y) — same convention as `rock.ts`.

import type { Node, XY } from "@/shared/aquarium/core/ir";
import { DEFAULT_SCENE_DESIGN } from "@/shared/aquarium/scene/scene-design";
import type { Generator } from "@/shared/aquarium/scene/types";
import { makeRng } from "@/shared/lib/rng";

const MOUND_DESIGN = DEFAULT_SCENE_DESIGN.species.substrateMound;
const PEBBLES_DESIGN = DEFAULT_SCENE_DESIGN.species.pebbles;

function polygonD(points: readonly XY[]): string {
  const F = (n: number) => n.toFixed(1);
  let d = `M ${F(points[0].x)} ${F(points[0].y)}`;
  for (let i = 1; i < points.length; i++) d += ` L ${F(points[i].x)} ${F(points[i].y)}`;
  return d + " Z";
}

export const generateSubstrateMound: Generator = ({ seed, scale }) => {
  // Read at call time — see anubias.ts's identical note on why.
  const MOUND_TOP = MOUND_DESIGN.topColor;
  const MOUND_BOTTOM = MOUND_DESIGN.bottomColor;
  const rng = makeRng(`substrate-mound-${seed}`);
  const D = MOUND_DESIGN;
  const width = (D.widthMin + rng() * D.widthRange) * scale;
  const height = (D.heightMin + rng() * D.heightRange) * scale;
  const vertexCount = D.vertexCountMin + Math.floor(rng() * D.vertexCountRange);

  // A smooth cosine hump, not a jagged rock silhouette — sand slumps into a
  // rounded rise, it doesn't facet. Small per-vertex jitter keeps it from
  // reading as a perfect, obviously-generated curve.
  const points: XY[] = [];
  for (let i = 0; i <= vertexCount; i++) {
    const t = i / vertexCount;
    const x = (t - 0.5) * width;
    const hump = Math.cos((t - 0.5) * Math.PI);
    const jitter = D.jitterMin + rng() * D.jitterRange;
    points.push({ x, y: -height * hump * jitter });
  }
  points.push({ x: width / 2, y: 0 });
  points.unshift({ x: -width / 2, y: 0 });

  const d = polygonD(points);
  const nodes: Node[] = [
    { kind: "path", d, paint: { type: "solid", color: MOUND_TOP } },
    {
      kind: "path",
      d,
      blend: "multiply",
      paint: {
        type: "linear",
        from: { x: 0, y: -height },
        to: { x: 0, y: 0 },
        stops: [
          { offset: 0, color: "rgba(0,0,0,0)" },
          { offset: 1, color: `${MOUND_BOTTOM}aa` },
        ],
      },
    },
  ];

  return {
    nodes,
    bbox: { x: -width / 2, y: -height, width, height },
    anchors: [],
    swayHeight: 0,
  };
};

export const generatePebbles: Generator = ({ seed, scale }) => {
  // Read at call time — see anubias.ts's identical note on why.
  const PEBBLE_COLORS = [PEBBLES_DESIGN.color1, PEBBLES_DESIGN.color2, PEBBLES_DESIGN.color3];
  const PEBBLE_HIGHLIGHT = PEBBLES_DESIGN.highlightColor;
  const rng = makeRng(`pebbles-${seed}`);
  const D = PEBBLES_DESIGN;
  const count = D.countMin + Math.floor(rng() * D.countRange);
  const spread = (D.spreadMin + rng() * D.spreadRange) * scale;
  const nodes: Node[] = [];
  let minX = 0;
  let maxX = 0;
  let maxR = 0;

  for (let i = 0; i < count; i++) {
    const r = (D.radiusMin + rng() * D.radiusRange) * scale;
    const cx = (rng() - 0.5) * spread;
    const cy = -r * (0.35 + rng() * 0.2); // sits partly embedded, not floating on the line
    const color = PEBBLE_COLORS[i % PEBBLE_COLORS.length];
    nodes.push({ kind: "circle", cx, cy, r, paint: { type: "solid", color } });
    nodes.push({
      kind: "circle",
      cx: cx - r * 0.3,
      cy: cy - r * 0.3,
      r: r * 0.4,
      blend: "screen",
      paint: { type: "solid", color: PEBBLE_HIGHLIGHT, opacity: 0.5 },
    });
    minX = Math.min(minX, cx - r);
    maxX = Math.max(maxX, cx + r);
    maxR = Math.max(maxR, r);
  }

  return {
    nodes,
    bbox: { x: minX, y: -maxR * 1.4, width: maxX - minX, height: maxR * 1.4 },
    anchors: [],
    swayHeight: 0,
  };
};
