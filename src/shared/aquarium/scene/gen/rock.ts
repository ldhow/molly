// Seiryu-style stone: an angular, jagged boulder sitting on the substrate.
// Local space: origin at the base CENTER (bottom edge on y=0), extending
// upward (-y).

import type { Node, XY } from "@/shared/aquarium/core/ir";
import type { Generator } from "@/shared/aquarium/scene/types";
import { makeRng } from "@/shared/lib/rng";

const STONE_DARK = "#2b3038";
const STONE_MID = "#454c57";
const STONE_LIGHT = "#6b7480";

const F = (n: number) => n.toFixed(1);

function polygonD(points: readonly XY[]): string {
  let d = `M ${F(points[0].x)} ${F(points[0].y)}`;
  for (let i = 1; i < points.length; i++) d += ` L ${F(points[i].x)} ${F(points[i].y)}`;
  return d + " Z";
}

export const generateSeiryuStone: Generator = ({ seed, scale }) => {
  const rng = makeRng(`seiryu-${seed}`);
  const width = (92 + rng() * 58) * scale;
  const height = (60 + rng() * 42) * scale;
  const vertexCount = 8 + Math.floor(rng() * 4);

  // Jagged silhouette: for each angle around the base-anchored ellipse,
  // perturb the radius so facets read as angular rock, not a smooth blob —
  // the bottom stays flat-ish (small perturbation) so it looks grounded.
  const points: XY[] = [];
  for (let i = 0; i < vertexCount; i++) {
    const t = i / vertexCount;
    const angle = Math.PI + t * Math.PI; // sweep the TOP half only (0..π above the base line)
    const bottomFlatten = Math.sin(t * Math.PI); // 0 at the two base corners, 1 at the apex
    const jitter = 1 - 0.22 + rng() * 0.44;
    const rx = (width / 2) * jitter;
    const ry = height * jitter * (0.4 + 0.6 * bottomFlatten);
    points.push({ x: Math.cos(angle) * rx, y: -Math.abs(Math.sin(angle)) * ry });
  }
  // Close along the base.
  points.push({ x: width / 2, y: 0 });
  points.unshift({ x: -width / 2, y: 0 });

  const d = polygonD(points);
  const apex = points.reduce((a, b) => (b.y < a.y ? b : a));

  const nodes: Node[] = [
    { kind: "path", d, paint: { type: "solid", color: STONE_MID } },
    {
      kind: "path",
      d,
      blend: "multiply",
      paint: {
        type: "linear",
        from: { x: -width / 2, y: 0 },
        to: { x: width * 0.15, y: apex.y },
        stops: [
          { offset: 0, color: "rgba(0,0,0,0.4)" },
          { offset: 1, color: "rgba(0,0,0,0)" },
        ],
      },
    },
    {
      kind: "path",
      d,
      blend: "screen",
      paint: {
        type: "linear",
        from: { x: apex.x - width * 0.1, y: apex.y },
        to: { x: apex.x + width * 0.25, y: apex.y * 0.3 },
        stops: [
          { offset: 0, color: `${STONE_LIGHT}55` },
          { offset: 1, color: "rgba(255,255,255,0)" },
        ],
      },
    },
    {
      kind: "path",
      d,
      paint: { type: "solid", color: STONE_DARK, opacity: 0.5 },
      stroke: { width: 1.4 },
    },
  ];

  return {
    nodes,
    bbox: { x: -width / 2, y: apex.y, width, height: -apex.y },
    anchors: [],
    swayHeight: 0,
  };
};
