// Axolotl body plan: an elongated undulating body via the same `pchip`
// top/bottom approach `fish/body-profile.ts` uses (unlike every other new
// species, this one spine-warps — see `render/creature-layer.tsx`'s
// `locomotion === "undulating"` branch), external feathery gill fronds and
// four small mostly-cosmetic legs (both built from `core/limb-chain.ts`'s
// tapered circle chain — proven safe on frog's legs), and a small rounded
// paddle tail with no fork, authored directly into the same profile tables
// rather than as a separate fin shape.
//
// Dependency-free: no React/RN/Skia imports. Runs under plain Node.

import type { Box, XY } from "@/shared/aquarium/core/ir";
import { circleChain, type ChainCircle } from "@/shared/aquarium/core/limb-chain";
import {
  linspace,
  pchip,
  polygonToPathD,
  type Curve1D,
  type CurvePoint,
} from "@/shared/aquarium/fish/profile";

const X0 = -29;
const LENGTH = 58;

/** Half-height tables — flare OUT near `u=1` (the opposite of a fish's tapering peduncle) to form the paddle tail directly in the profile, the same "author it into the curve" trick `body-profile.ts` uses for the crest/belly. */
const TOP: CurvePoint[] = [
  { x: 0.0, y: 5.0 },
  { x: 0.12, y: 6.5 },
  { x: 0.28, y: 8.6 },
  { x: 0.45, y: 9.6 },
  { x: 0.62, y: 8.6 },
  { x: 0.78, y: 6.4 },
  { x: 0.88, y: 7.4 },
  { x: 1.0, y: 11.2 },
  { x: 1.08, y: 9.2 },
];
const BOTTOM: CurvePoint[] = [
  { x: 0.0, y: 5.6 },
  { x: 0.12, y: 7.2 },
  { x: 0.28, y: 9.2 },
  { x: 0.45, y: 10.2 },
  { x: 0.62, y: 9.0 },
  { x: 0.78, y: 6.8 },
  { x: 0.88, y: 7.8 },
  { x: 1.0, y: 11.6 },
  { x: 1.08, y: 9.6 },
];

/** Same rounded-cap trick `fish/anatomy.ts`'s `noseCapPoints` uses, generalized to either end — axolotls are blunt-headed AND blunt-tailed, unlike a fish's pointed peduncle. */
function roundCapPoints(
  x: number,
  topY: number,
  bottomY: number,
  outward: 1 | -1,
  steps = 12,
): XY[] {
  const midY = (topY + bottomY) / 2;
  const radiusY = (bottomY - topY) / 2;
  const bulge = Math.min(9, radiusY * 0.7);
  const out: XY[] = [];
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const angle = Math.PI / 2 - t * Math.PI;
    out.push({
      x: x + outward * Math.sin(angle + Math.PI / 2) * bulge,
      y: midY + Math.sin(angle) * radiusY,
    });
  }
  return out;
}

export interface AxolotlAnatomy {
  bodyD: string;
  x0: number;
  length: number;
  baseTop: Curve1D;
  baseBottom: Curve1D;
  gillsNear: ChainCircle[][];
  gillsFar: ChainCircle[][];
  legs: ChainCircle[][];
  eyeL: XY;
  eyeR: XY;
  bounds: Box;
}

function xAt(u: number): number {
  return X0 + u * LENGTH;
}

/** One gill frond: a thin tapered stalk fanning up and out from a head-side base point, plus a couple of small "bud" circles along its length for a feathery (not spiky) silhouette. */
function buildGillFrond(base: XY, angleDeg: number, len: number): ChainCircle[] {
  const angle = (angleDeg * Math.PI) / 180;
  const tip: XY = { x: base.x + Math.cos(angle) * len, y: base.y + Math.sin(angle) * len };
  const stalk = circleChain(base, 1.3, tip, 0.5);
  const budAt = (t: number, r: number) =>
    circleChain(
      { x: base.x + (tip.x - base.x) * t, y: base.y + (tip.y - base.y) * t },
      r,
      { x: base.x + (tip.x - base.x) * (t + 0.001), y: base.y + (tip.y - base.y) * (t + 0.001) },
      r,
    );
  return [...stalk, ...budAt(0.45, 1.3), ...budAt(0.75, 1.1)];
}

function buildLegStub(hip: XY, angleDeg: number): ChainCircle[] {
  const angle = (angleDeg * Math.PI) / 180;
  const foot: XY = { x: hip.x + Math.cos(angle) * 8, y: hip.y + Math.sin(angle) * 8 };
  return circleChain(hip, 2.6, foot, 1.1);
}

/** Deterministic — every variant shares the same body shape (see `snail/anatomy.ts`'s identical precedent); only `pigment.ts` varies per variant. */
export function buildAxolotlAnatomy(): AxolotlAnatomy {
  const baseTop = pchip(TOP);
  const baseBottom = pchip(BOTTOM);

  const SAMPLES = 120;
  const topPass: XY[] = linspace(0, 1, SAMPLES).map((u) => ({ x: xAt(u), y: -baseTop(u) }));
  const bottomPass: XY[] = linspace(1, 0, SAMPLES).map((u) => ({ x: xAt(u), y: baseBottom(u) }));
  const tailCap = roundCapPoints(xAt(1), -baseTop(1), baseBottom(1), 1);
  const noseCap = roundCapPoints(xAt(0), -baseTop(0), baseBottom(0), -1);

  const bodyPoints = [...topPass, ...tailCap.reverse(), ...bottomPass, ...noseCap];
  const bodyD = polygonToPathD(bodyPoints);

  const headBaseNear: XY = { x: xAt(0.1), y: -baseTop(0.1) * 0.5 };
  const headBaseFar: XY = { x: xAt(0.1), y: baseBottom(0.1) * 0.5 };
  const gillsNear = [-58, -22, 12].map((deg) => buildGillFrond(headBaseNear, deg, 15));
  const gillsFar = [-58, -22, 12].map((deg) => buildGillFrond(headBaseFar, deg, 13));

  const legs = [
    buildLegStub({ x: xAt(0.32), y: -baseTop(0.32) * 0.65 }, 100),
    buildLegStub({ x: xAt(0.32), y: baseBottom(0.32) * 0.65 }, 80),
    buildLegStub({ x: xAt(0.72), y: -baseTop(0.72) * 0.65 }, 100),
    buildLegStub({ x: xAt(0.72), y: baseBottom(0.72) * 0.65 }, 80),
  ];

  const eyeL: XY = { x: xAt(0.14), y: -baseTop(0.14) * 0.75 };
  const eyeR: XY = { x: xAt(0.17), y: -baseTop(0.17) * 0.75 - 1.5 };

  const allPoints = [
    ...bodyPoints,
    ...gillsNear.flat().map((c) => ({ x: c.cx, y: c.cy })),
    ...gillsFar.flat().map((c) => ({ x: c.cx, y: c.cy })),
    ...legs.flat().map((c) => ({ x: c.cx, y: c.cy })),
  ];
  const minX = Math.min(...allPoints.map((p) => p.x)) - 4;
  const maxX = Math.max(...allPoints.map((p) => p.x)) + 4;
  const minY = Math.min(...allPoints.map((p) => p.y)) - 4;
  const maxY = Math.max(...allPoints.map((p) => p.y)) + 4;
  const bounds: Box = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };

  return {
    bodyD,
    x0: X0,
    length: LENGTH,
    baseTop,
    baseBottom,
    gillsNear,
    gillsFar,
    legs,
    eyeL,
    eyeR,
    bounds,
  };
}
