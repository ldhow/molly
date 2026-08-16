// Seiryu-style stone: an angular, jagged boulder sitting on the substrate.
// Local space: origin at the base CENTER (bottom edge on y=0), extending
// upward (-y).

import type { Node, XY } from "@/shared/aquarium/core/ir";
import { DEFAULT_SCENE_DESIGN } from "@/shared/aquarium/scene/scene-design";
import type { Generator } from "@/shared/aquarium/scene/types";
import { makeRng } from "@/shared/lib/rng";

const DESIGN = DEFAULT_SCENE_DESIGN.species.seiryuStone;

const F = (n: number) => n.toFixed(1);

function polygonD(points: readonly XY[]): string {
  let d = `M ${F(points[0].x)} ${F(points[0].y)}`;
  for (let i = 1; i < points.length; i++) d += ` L ${F(points[i].x)} ${F(points[i].y)}`;
  return d + " Z";
}

export const generateSeiryuStone: Generator = ({ seed, scale }) => {
  // Read at call time — see anubias.ts's identical note on why.
  const STONE_DARK = DESIGN.darkColor;
  const STONE_MID = DESIGN.midColor;
  const STONE_LIGHT = DESIGN.lightColor;
  const rng = makeRng(`seiryu-${seed}`);
  const width = (DESIGN.widthMin + rng() * DESIGN.widthRange) * scale;
  const height = (DESIGN.heightMin + rng() * DESIGN.heightRange) * scale;
  const vertexCount = DESIGN.vertexCountMin + Math.floor(rng() * DESIGN.vertexCountRange);

  // Jagged silhouette: for each angle around the base-anchored ellipse,
  // perturb the radius so facets read as angular rock, not a smooth blob —
  // the bottom stays flat-ish (small perturbation) so it looks grounded.
  const points: XY[] = [];
  for (let i = 0; i < vertexCount; i++) {
    const t = i / vertexCount;
    const angle = Math.PI + t * Math.PI; // sweep the TOP half only (0..π above the base line)
    const bottomFlatten = Math.sin(t * Math.PI); // 0 at the two base corners, 1 at the apex
    const jitter = DESIGN.jitterMin + rng() * DESIGN.jitterRange;
    const rx = (width / 2) * jitter;
    const ry = height * jitter * (0.4 + 0.6 * bottomFlatten);
    points.push({ x: Math.cos(angle) * rx, y: -Math.abs(Math.sin(angle)) * ry });
  }
  // Close along the base.
  points.push({ x: width / 2, y: 0 });
  points.unshift({ x: -width / 2, y: 0 });

  const d = polygonD(points);
  const apex = points.reduce((a, b) => (b.y < a.y ? b : a));

  // Interior facets: seiryu stone reads as angular rock planes, not a smooth
  // boulder — a few seam lines from an upper vertex down to the base center,
  // each paired with a triangular light/dark wedge so adjacent faces catch
  // the (implied) light differently.
  const facetCount = DESIGN.facetCountMin + Math.floor(rng() * DESIGN.facetCountRange);
  const facetNodes: Node[] = [];
  const interior = points.slice(1, points.length - 1); // exclude the two base corners
  for (let f = 0; f < facetCount && interior.length > 0; f++) {
    const vi = interior[Math.floor(rng() * interior.length)];
    const neighborIdx = Math.max(
      0,
      Math.min(interior.length - 1, points.indexOf(vi) - 1 + Math.floor(rng() * 3) - 1),
    );
    const neighbor = interior[neighborIdx] ?? vi;
    const wedgeD = `M ${F(vi.x)} ${F(vi.y)} L ${F(neighbor.x)} ${F(neighbor.y)} L 0 0 Z`;
    const lighter = rng() > 0.5;
    facetNodes.push({
      kind: "path",
      d: wedgeD,
      blend: lighter ? "screen" : "multiply",
      paint: { type: "solid", color: lighter ? STONE_LIGHT : STONE_DARK, opacity: 0.18 },
    });
    facetNodes.push({
      kind: "path",
      d: `M ${F(vi.x)} ${F(vi.y)} L 0 0`,
      paint: { type: "solid", color: DESIGN.seamColor, opacity: 0.3 },
      stroke: { width: 0.9 },
    });
  }

  const nodes: Node[] = [
    { kind: "path", d, paint: { type: "solid", color: STONE_MID } },
    ...facetNodes,
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
