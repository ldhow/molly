// Otter body plan: an elongated body via the same `pchip` top/bottom
// approach `axolotl/anatomy.ts` uses, tapering smoothly into a thick tail
// with NO fin/paddle (the tail is just the profile's own tables continuing
// to narrow past the torso, unlike axolotl's flare-out), a separate rounder
// mammal head with small ears, forward-facing eyes, and a few whisker
// strokes, plus four short stub legs. Rigid, the largest `sizeRatio` of any
// species — the showcase companion.
//
// Dependency-free: no React/RN/Skia imports. Runs under plain Node.

import type { Box, XY } from "@/shared/aquarium/core/ir";
import { circleChain, type ChainCircle } from "@/shared/aquarium/core/limb-chain";
import { linspace, pchip, polygonToPathD, type CurvePoint } from "@/shared/aquarium/fish/profile";

const X0 = -32;
const LENGTH = 64;

/** Torso (u<0.55) then a continuous taper into a thick tail with no fin — the opposite move from axolotl's flare, same "author it into the curve" technique. */
const TOP: CurvePoint[] = [
  { x: 0.0, y: 6.5 },
  { x: 0.15, y: 9.5 },
  { x: 0.3, y: 11.0 },
  { x: 0.45, y: 10.0 },
  { x: 0.55, y: 8.5 },
  { x: 0.7, y: 6.0 },
  { x: 0.85, y: 3.5 },
  { x: 1.0, y: 1.5 },
  { x: 1.08, y: 0.8 },
];
const BOTTOM: CurvePoint[] = [
  { x: 0.0, y: 7.0 },
  { x: 0.15, y: 10.5 },
  { x: 0.3, y: 12.5 },
  { x: 0.45, y: 11.0 },
  { x: 0.55, y: 9.0 },
  { x: 0.7, y: 6.2 },
  { x: 0.85, y: 3.5 },
  { x: 1.0, y: 1.5 },
  { x: 1.08, y: 0.8 },
];

function ellipsePathD(cx: number, cy: number, rx: number, ry: number): string {
  const F = (n: number) => n.toFixed(1);
  return (
    `M ${F(cx - rx)} ${F(cy)} ` +
    `A ${F(rx)} ${F(ry)} 0 1 0 ${F(cx + rx)} ${F(cy)} ` +
    `A ${F(rx)} ${F(ry)} 0 1 0 ${F(cx - rx)} ${F(cy)} Z`
  );
}

/** Same rounded-cap trick `axolotl/anatomy.ts`'s `roundCapPoints` uses — a blunt tail tip (no fork, no paddle) instead of a pointed peduncle. The nose end is capped by the separate head ellipse instead, so this is tail-only. */
function tailCapPoints(x: number, topY: number, bottomY: number, steps = 10): XY[] {
  const midY = (topY + bottomY) / 2;
  const radiusY = (bottomY - topY) / 2;
  const bulge = Math.min(4, radiusY * 0.8);
  const out: XY[] = [];
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const angle = Math.PI / 2 - t * Math.PI;
    out.push({ x: x + Math.sin(angle + Math.PI / 2) * bulge, y: midY + Math.sin(angle) * radiusY });
  }
  return out;
}

export interface OtterAnatomy {
  bodyD: string;
  headD: string;
  earL: XY;
  earR: XY;
  eyeL: XY;
  eyeR: XY;
  whiskersD: string[];
  legs: ChainCircle[][];
  bounds: Box;
}

function xAt(u: number): number {
  return X0 + u * LENGTH;
}

function buildLegStub(hip: XY): ChainCircle[] {
  const foot: XY = { x: hip.x, y: hip.y + 9 };
  return circleChain(hip, 3.2, foot, 2.1);
}

/** Deterministic — every variant shares the same body shape (see `snail/anatomy.ts`'s identical precedent); only `pigment.ts` varies per variant. */
export function buildOtterAnatomy(): OtterAnatomy {
  const baseTop = pchip(TOP);
  const baseBottom = pchip(BOTTOM);

  const SAMPLES = 120;
  const topPass: XY[] = linspace(0, 1, SAMPLES).map((u) => ({ x: xAt(u), y: -baseTop(u) }));
  const bottomPass: XY[] = linspace(1, 0, SAMPLES).map((u) => ({ x: xAt(u), y: baseBottom(u) }));
  const tailCap = tailCapPoints(xAt(1), -baseTop(1), baseBottom(1));

  const bodyPoints = [...topPass, ...tailCap.reverse(), ...bottomPass];
  const bodyD = polygonToPathD(bodyPoints);

  const headCx = X0 - 8;
  const headD = ellipsePathD(headCx, -0.5, 10.5, 9);
  const earL: XY = { x: headCx - 3, y: -8.5 };
  const earR: XY = { x: headCx + 4, y: -8.5 };
  const eyeL: XY = { x: headCx - 5, y: -1.5 };
  const eyeR: XY = { x: headCx + 2.5, y: -1.5 };

  const whiskerBase: XY = { x: headCx - 10, y: 3 };
  const whiskersD = [-8, 0, 8].map(
    (dy) =>
      `M ${whiskerBase.x.toFixed(1)} ${whiskerBase.y.toFixed(1)} Q ${(whiskerBase.x - 9).toFixed(1)} ${(whiskerBase.y + dy * 0.3).toFixed(1)} ${(whiskerBase.x - 16).toFixed(1)} ${(whiskerBase.y + dy).toFixed(1)}`,
  );

  // All four legs hang from the BELLY (`baseBottom`), never the back — this
  // is a side-view swimming body like a fish's, not a top-down seated pose
  // like frog's. "Near"/"far" (bake-creature.ts's draw order) is a small x
  // offset within the same belly-side pair, the same depth-cue trick fish's
  // pelvicNear/pelvicFar fins use, not a top/bottom split.
  const legs = [
    buildLegStub({ x: xAt(0.22), y: baseBottom(0.22) * 0.55 }),
    buildLegStub({ x: xAt(0.25), y: baseBottom(0.25) * 0.8 }),
    buildLegStub({ x: xAt(0.52), y: baseBottom(0.52) * 0.55 }),
    buildLegStub({ x: xAt(0.55), y: baseBottom(0.55) * 0.8 }),
  ];

  const allPoints = [
    ...bodyPoints,
    { x: headCx - 10.5, y: -0.5 },
    { x: headCx + 10.5, y: -0.5 },
    { x: earL.x, y: earL.y - 3 },
    { x: earR.x, y: earR.y - 3 },
    { x: whiskerBase.x - 16, y: whiskerBase.y - 8 },
    { x: whiskerBase.x - 16, y: whiskerBase.y + 8 },
    ...legs.flat().map((c) => ({ x: c.cx, y: c.cy })),
  ];
  const minX = Math.min(...allPoints.map((p) => p.x)) - 4;
  const maxX = Math.max(...allPoints.map((p) => p.x)) + 4;
  const minY = Math.min(...allPoints.map((p) => p.y)) - 4;
  const maxY = Math.max(...allPoints.map((p) => p.y)) + 4;
  const bounds: Box = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };

  return { bodyD, headD, earL, earR, eyeL, eyeR, whiskersD, legs, bounds };
}
