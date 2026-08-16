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
import { DEFAULT_SCENE_DESIGN } from "@/shared/aquarium/scene/scene-design";
import type { Generator } from "@/shared/aquarium/scene/types";
import { lighten } from "@/shared/lib/color";
import { makeRng } from "@/shared/lib/rng";

import { ribbonPath } from "./ribbon";

const VALLISNERIA_DESIGN = DEFAULT_SCENE_DESIGN.species.vallisneria;
const STEM_BUSH_DESIGN = DEFAULT_SCENE_DESIGN.species.stemBush;
const ROTALA_DESIGN = DEFAULT_SCENE_DESIGN.species.rotala;

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
  // Read at call time — see anubias.ts's identical note on why.
  const BLADE_COLORS = [
    VALLISNERIA_DESIGN.color1,
    VALLISNERIA_DESIGN.color2,
    VALLISNERIA_DESIGN.color3,
  ];
  const rng = makeRng(`vallisneria-${seed}`);
  const D = VALLISNERIA_DESIGN;
  const bladeCount = D.bladeCountMin + Math.floor(rng() * D.bladeCountRange);
  const nodes: Node[] = [];
  let bbox = { x: 0, y: 0, width: 1, height: 1 };

  for (let i = 0; i < bladeCount; i++) {
    const height = (D.heightMin + rng() * D.heightRange) * scale;
    const lean = (i - (bladeCount - 1) / 2) * D.leanBase + (rng() - 0.5) * D.leanJitter;
    const curve = (rng() - 0.5) * D.curveRange;
    const baseX = (i - (bladeCount - 1) / 2) * D.bladeSpacing * scale;
    const spine: XY[] = [
      { x: baseX, y: 0 },
      { x: baseX + lean, y: -height * 0.4 },
      { x: baseX + lean + curve, y: -height * 0.8 },
      { x: baseX + lean + curve * 1.4, y: -height },
    ];
    const width = (D.widthMin + rng() * D.widthRange) * scale;
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
  return { nodes, bbox, anchors: [], swayHeight: D.swayHeightFactor * scale };
};

/** Shared body for stemBush and rotala — a bushier silhouette of N stems each carrying one oval leaf, differing only in palette/proportions via `design`. */
function generateStemPlant(
  design: {
    leafColor1: string;
    leafColor2: string;
    leafColor3: string;
    stemColor: string;
    stemCountMin: number;
    stemCountRange: number;
    angleSpreadBase: number;
    angleSpreadRange: number;
    stemLenMin: number;
    stemLenRange: number;
    leafLenMin: number;
    leafLenRange: number;
    leafWidthFactor: number;
    swayHeightFactor: number;
  },
  rngSeedPrefix: string,
  seed: number,
  scale: number,
): {
  nodes: Node[];
  bbox: { x: number; y: number; width: number; height: number };
  anchors: never[];
  swayHeight: number;
} {
  const LEAF_COLORS = [design.leafColor1, design.leafColor2, design.leafColor3];
  const rng = makeRng(`${rngSeedPrefix}-${seed}`);
  const D = design;
  const stemCount = D.stemCountMin + Math.floor(rng() * D.stemCountRange);
  const nodes: Node[] = [];
  let bbox = { x: 0, y: 0, width: 1, height: 1 };

  for (let i = 0; i < stemCount; i++) {
    const angleDeg =
      -90 + (i - (stemCount - 1) / 2) * (D.angleSpreadBase + rng() * D.angleSpreadRange);
    const rad = (angleDeg * Math.PI) / 180;
    const stemLen = (D.stemLenMin + rng() * D.stemLenRange) * scale;
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
      paint: { type: "solid", color: D.stemColor, opacity: 0.6 },
    });

    const leafLen = (D.leafLenMin + rng() * D.leafLenRange) * scale;
    const leafWidth = leafLen * D.leafWidthFactor;
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
  return { nodes, bbox, anchors: [], swayHeight: D.swayHeightFactor * scale };
}

export const generateStemBush: Generator = ({ seed, scale }) =>
  generateStemPlant(STEM_BUSH_DESIGN, "stembush", seed, scale);

/** Red-stem accent (rotala/ludwigia style) — the same bushy stem-plant body as stemBush, just a warmer palette and a distinct rng stream so it never coincides with a stemBush placement using the same seed. */
export const generateRotala: Generator = ({ seed, scale }) =>
  generateStemPlant(ROTALA_DESIGN, "rotala", seed, scale);
