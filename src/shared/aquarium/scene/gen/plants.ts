// Two stem plants, both growing straight from the substrate (no attachment
// support — unlike anubias, these aren't epiphytes):
//
// - vallisneria: a handful of long, thin, flowing blades — a classic
//   background "grass" that reads as gentle current motion.
// - stemBush: a denser, shorter cluster of small oval leaves on branching
//   stems — a mid-ground filler with a bushier silhouette than a single
//   blade or a single anubias plant.
//
// Local space: origin at the base, +y down, blades authored growing to -y.

import type { Node, XY } from "@/shared/aquarium/core/ir";
import { unionBox } from "@/shared/aquarium/core/ir";
import type { Generator } from "@/shared/aquarium/scene/types";
import { lighten } from "@/shared/lib/color";
import { makeRng } from "@/shared/lib/rng";

import { ribbonPath } from "./ribbon";

const BLADE_COLORS = ["#2e7d57", "#256b4a", "#35906a"];
const LEAF_COLORS = ["#1f6b46", "#2f8f5b", "#175c3d"];

/** Base-to-tip gradient instead of a flat fill — a blade/leaf catches more light toward its tip, the "richer leaf-tone gradients" pass. */
const bladeGradient = (color: string, from: XY, to: XY) => ({
  type: "linear" as const,
  from,
  to,
  stops: [
    { offset: 0, color },
    { offset: 1, color: lighten(color, 0.22) },
  ],
});

export const generateVallisneria: Generator = ({ seed, scale }) => {
  const rng = makeRng(`vallisneria-${seed}`);
  const bladeCount = 4 + Math.floor(rng() * 3);
  const nodes: Node[] = [];
  let bbox = { x: 0, y: 0, width: 1, height: 1 };

  for (let i = 0; i < bladeCount; i++) {
    const height = (180 + rng() * 140) * scale;
    const lean = (i - (bladeCount - 1) / 2) * 4 + (rng() - 0.5) * 6;
    const curve = (rng() - 0.5) * 26;
    const baseX = (i - (bladeCount - 1) / 2) * 5 * scale;
    const spine: XY[] = [
      { x: baseX, y: 0 },
      { x: baseX + lean, y: -height * 0.4 },
      { x: baseX + lean + curve, y: -height * 0.8 },
      { x: baseX + lean + curve * 1.4, y: -height },
    ];
    const width = (2.2 + rng() * 1.2) * scale;
    const d = ribbonPath(spine, (t) => width * (1 - t * 0.85));
    const color = BLADE_COLORS[i % BLADE_COLORS.length];
    const tip = spine[spine.length - 1];
    nodes.push({
      kind: "path",
      d,
      paint: { ...bladeGradient(color, spine[0], tip), opacity: 0.92 },
    });
    bbox = unionBox(bbox, {
      x: baseX + Math.min(0, lean + curve * 1.4) - width,
      y: -height,
      width: Math.abs(lean + curve * 1.4) + width * 2,
      height,
    });
  }
  return { nodes, bbox, anchors: [], swayHeight: 90 * scale };
};

export const generateStemBush: Generator = ({ seed, scale }) => {
  const rng = makeRng(`stembush-${seed}`);
  const stemCount = 5 + Math.floor(rng() * 4);
  const nodes: Node[] = [];
  let bbox = { x: 0, y: 0, width: 1, height: 1 };

  for (let i = 0; i < stemCount; i++) {
    const angleDeg = -90 + (i - (stemCount - 1) / 2) * (14 + rng() * 6);
    const rad = (angleDeg * Math.PI) / 180;
    const stemLen = (34 + rng() * 40) * scale;
    const tipX = Math.cos(rad) * stemLen;
    const tipY = Math.sin(rad) * stemLen;
    const stemD = ribbonPath(
      [
        { x: 0, y: 0 },
        { x: tipX, y: tipY },
      ],
      () => 1 * scale,
    );
    nodes.push({
      kind: "path",
      d: stemD,
      paint: { type: "solid", color: "#0d3322", opacity: 0.6 },
    });

    const leafLen = (13 + rng() * 9) * scale;
    const leafWidth = leafLen * 0.65;
    const leafSpine: XY[] = [
      { x: 0, y: 0 },
      { x: leafWidth * 0.2, y: -leafLen * 0.6 },
      { x: 0, y: -leafLen },
    ];
    const leafD = ribbonPath(
      leafSpine,
      (t) => leafWidth * Math.sin(Math.min(1, t * 1.1) * Math.PI),
    );
    nodes.push({
      kind: "group",
      children: [
        {
          kind: "path",
          d: leafD,
          paint: {
            ...bladeGradient(LEAF_COLORS[i % LEAF_COLORS.length], leafSpine[0], leafSpine[2]),
            opacity: 0.95,
          },
        },
      ],
      transform: { translateX: tipX, translateY: tipY, rotateDeg: angleDeg + 90 },
    });

    const reach = stemLen + leafLen;
    bbox = unionBox(bbox, {
      x: tipX - reach * 0.4,
      y: tipY - reach,
      width: reach * 0.8,
      height: reach,
    });
  }
  return { nodes, bbox, anchors: [], swayHeight: 24 * scale };
};
