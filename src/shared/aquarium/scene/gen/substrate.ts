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
import type { Generator } from "@/shared/aquarium/scene/types";
import { makeRng } from "@/shared/lib/rng";

const MOUND_TOP = "#5a4632";
const MOUND_BOTTOM = "#3c2e20";
const PEBBLE_COLORS = ["#6b6258", "#544c43", "#7a7168"];
const PEBBLE_HIGHLIGHT = "#9a9186";

function polygonD(points: readonly XY[]): string {
  const F = (n: number) => n.toFixed(1);
  let d = `M ${F(points[0].x)} ${F(points[0].y)}`;
  for (let i = 1; i < points.length; i++) d += ` L ${F(points[i].x)} ${F(points[i].y)}`;
  return d + " Z";
}

export const generateSubstrateMound: Generator = ({ seed, scale }) => {
  const rng = makeRng(`substrate-mound-${seed}`);
  const width = (260 + rng() * 140) * scale;
  const height = (34 + rng() * 20) * scale;
  const vertexCount = 10 + Math.floor(rng() * 3);

  // A smooth cosine hump, not a jagged rock silhouette — sand slumps into a
  // rounded rise, it doesn't facet. Small per-vertex jitter keeps it from
  // reading as a perfect, obviously-generated curve.
  const points: XY[] = [];
  for (let i = 0; i <= vertexCount; i++) {
    const t = i / vertexCount;
    const x = (t - 0.5) * width;
    const hump = Math.cos((t - 0.5) * Math.PI);
    const jitter = 1 - 0.06 + rng() * 0.12;
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
  const rng = makeRng(`pebbles-${seed}`);
  const count = 4 + Math.floor(rng() * 4);
  const spread = (60 + rng() * 40) * scale;
  const nodes: Node[] = [];
  let minX = 0;
  let maxX = 0;
  let maxR = 0;

  for (let i = 0; i < count; i++) {
    const r = (3 + rng() * 4) * scale;
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
