// Shrimp body plan — a SIDE-PROFILE crawler, same "sole at y = 0" contract
// as `snail/anatomy.ts` (this module's closest relative): shrimp scavenge
// along the substrate, the glass and plant stems on their walking legs, so
// `sim/crawl.ts` binds them the same way it binds a snail. (They can also
// dart in a straight line through open water — see `sim/crawl.ts`'s
// `stepCrawl` `canDash` branch — but that is a brief exception to a life
// spent on surfaces, and it changes nothing about this art contract.)
//
// LOCAL FRAME (identical contract to `snail/anatomy.ts` — see that file's
// header for the full rationale, and `scripts/verify-aquarium.ts` for the
// assertion):
//
//   - the leg-feet's contact line is y = 0, and nothing meaningful sits below it
//   - +x is FORWARD (the direction of travel); the head is at +x
//   - -y is UP, away from the surface it is stuck to
//
// THE BODY IS A CURVED SPINE, NOT A STRAIGHT TAPER. The first build used
// `otter`/`axolotl`'s straight `pchip` top/bottom pair (one x axis, two
// half-height curves) and read as a smooth sausage with stripes on it — a
// real shrimp is unmistakably ARCHED: the carapace rides high, the abdomen
// curls down and back into the tail fan. So this follows `snail/anatomy.ts`'s
// technique instead: a parametric centerline (`spineAt`) plus a half-height
// (`bodyHalfHeightAt`), traced with `ribbonAlongPath`. Both are exported,
// because `pigment.ts` builds the segment plates and colour bands along the
// SAME two functions the outline comes from — a band can't drift out of
// register with the shape when there is only one shape function (again, the
// snail's rule).
//
// The other things that make it read as a shrimp rather than a prawn-shaped
// blob: a pointed rostrum spike off the front of the carapace, five thin
// walking legs reaching the sole line, four small swimmerets tucked under
// the abdomen, and a tail fan of three blades fanned around the spine's own
// tangent at u = 1 (so it always trails the curve rather than sticking out
// at a hardcoded angle).
//
// The antennae are the one defining, independently-animated feature, baked
// SEPARATELY so they can sway (mirrors the snail's eye-stalk split; see
// `bake-creature.ts`). Two long ones sweep BACK over the body and two short
// antennules point forward, which is the real arrangement.
//
// Dependency-free: no React/RN/Skia imports. Runs under plain Node.

import type { Box, XY } from "@/shared/aquarium/core/ir";
import { ribbonAlongPath, toRad } from "@/shared/aquarium/core/pigment-toolkit";
import { circleChain, type ChainCircle } from "@/shared/aquarium/core/limb-chain";
import { pchip, type CurvePoint } from "@/shared/aquarium/fish/profile";

const HEAD_X = 30;
const TAIL_X = -26;
const SPAN = HEAD_X - TAIL_X;

/**
 * HEIGHT of the body centreline above the sole line, by `u` (0 = head,
 * 1 = tail base). Stored positive and negated in `spinePoint` — authoring it
 * as "how high off the ground" is far easier to reason about than authoring
 * negative y directly. The arch peaks at the carapace and curls back down
 * into the tail, which is the whole silhouette.
 */
const SPINE_H: CurvePoint[] = [
  { x: 0.0, y: 14.5 },
  { x: 0.16, y: 19.8 }, // carapace — the top of the arch
  { x: 0.36, y: 19.0 },
  { x: 0.58, y: 16.6 },
  { x: 0.8, y: 13.4 },
  { x: 1.0, y: 11.0 }, // tail base, curling back down
];

/** Half-height PERPENDICULAR to the spine — the body's thickness, deepest at the carapace. */
const HALF_H: CurvePoint[] = [
  { x: 0.0, y: 1.2 },
  { x: 0.05, y: 5.8 },
  { x: 0.18, y: 10.2 }, // carapace, the deepest part
  { x: 0.34, y: 9.0 },
  { x: 0.56, y: 7.2 },
  { x: 0.78, y: 5.4 },
  { x: 1.0, y: 3.0 },
];

const spineHCurve = pchip(SPINE_H);
const halfHCurve = pchip(HALF_H);

const clamp01 = (u: number) => Math.min(1, Math.max(0, u));

function spinePoint(u: number): XY {
  const c = clamp01(u);
  return { x: HEAD_X - c * SPAN, y: -spineHCurve(c) };
}

/**
 * Point + outward (dorsal) normal at `u` — the `at` callback
 * `ribbonAlongPath` wants, and the one shape function `pigment.ts` shares.
 * `point + normal * halfHeight` is the BACK, `point - normal * halfHeight`
 * is the BELLY; the tangent is `(normal.y, -normal.x)`.
 */
export function spineAt(u: number): { point: XY; normal: XY } {
  const h = 1e-3;
  const a = spinePoint(u - h);
  const b = spinePoint(u + h);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { point: spinePoint(u), normal: { x: -dy / len, y: dx / len } };
}

export function bodyHalfHeightAt(u: number): number {
  return halfHCurve(clamp01(u));
}

/** Where the abdomen's articulated plates start — everything forward of this is one solid carapace, as on a real shrimp. */
export const ABDOMEN_START = 0.38;

interface Antenna {
  /** Filled, tapered shaft — see `snail/anatomy.ts`'s identical `Tentacle.d`. */
  d: string;
  /** Long ones sweep back over the body; short antennules point forward. Drives the bake's colour/opacity split. */
  long: boolean;
}

/** Quadratic Bezier point + normal at `u` — identical to `snail/anatomy.ts`'s `quadAt`, duplicated locally rather than shared (each is a tiny, dependency-free, per-species helper). */
function quadAt(p0: XY, pc: XY, p1: XY) {
  return (u: number) => {
    const m = 1 - u;
    const point = {
      x: m * m * p0.x + 2 * m * u * pc.x + u * u * p1.x,
      y: m * m * p0.y + 2 * m * u * pc.y + u * u * p1.y,
    };
    const dx = 2 * m * (pc.x - p0.x) + 2 * u * (p1.x - pc.x);
    const dy = 2 * m * (pc.y - p0.y) + 2 * u * (p1.y - pc.y);
    const len = Math.hypot(dx, dy) || 1;
    return { point, normal: { x: -dy / len, y: dx / len } };
  };
}

function buildAntenna(p0: XY, pc: XY, p1: XY, w0: number, w1: number, long: boolean): Antenna {
  return {
    d: ribbonAlongPath({
      uStart: 0,
      uEnd: 1,
      at: quadAt(p0, pc, p1),
      halfWidth: (u) => (w0 + (w1 - w0) * u) / 2,
      samples: 22,
    }),
    long,
  };
}

/** A simple tapered leaf/blade — the tail fan's uropods and telson. */
function finBladeD(base: XY, angleDeg: number, length: number, width: number): string {
  const rad = toRad(angleDeg);
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const nx = -dy;
  const ny = dx;
  const tip: XY = { x: base.x + dx * length, y: base.y + dy * length };
  const mid: XY = { x: base.x + dx * length * 0.55, y: base.y + dy * length * 0.55 };
  const F = (n: number) => n.toFixed(1);
  return (
    `M ${F(base.x)} ${F(base.y)} ` +
    `Q ${F(mid.x + nx * width)} ${F(mid.y + ny * width)} ${F(tip.x)} ${F(tip.y)} ` +
    `Q ${F(mid.x - nx * width)} ${F(mid.y - ny * width)} ${F(base.x)} ${F(base.y)} Z`
  );
}

function pathPoints(d: string): XY[] {
  const nums = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  const pts: XY[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] });
  return pts;
}

function unionPoints(pts: XY[]): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function padBox(b: Box, pad: number): Box {
  return { x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2 };
}

function unionBoxes(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

export interface ShrimpAnatomy {
  bodyD: string;
  /** The pointed beak off the front of the carapace — drawn under the body so its root is buried. */
  rostrumD: string;
  /** Rostrum tip, so `verify-aquarium.ts` can assert the art faces +x. */
  rostrumTip: XY;
  eye: XY;
  eyeRadius: number;
  /** Walking legs (pereiopods) — every foot lands exactly on the sole line. */
  legs: ChainCircle[][];
  /** Swimmerets (pleopods) under the abdomen — short, and deliberately NOT reaching the ground. */
  swimmerets: ChainCircle[][];
  tailFanD: string[];
  /** Far antennae first, so they draw behind — mirrors `snail/anatomy.ts`'s far-first eye-stalk ordering. */
  antennae: Antenna[];
  /** Local-space bounds of body + legs + eye + tail fan only (NOT the antennae — those bake separately). */
  bodyBounds: Box;
  /** Local-space bounds of the antennae only. */
  antennaeBounds: Box;
  /** Union of both — what a whole-shrimp bake (preview, dead) covers. */
  bounds: Box;
}

const ANTENNA_PIVOT_U = 0.05;

/** Rotation pivot for the antenna sway — where they emerge from the head, tucked inside the carapace so a few degrees of swing never opens a seam at the roots. A real exported constant (like `snail/anatomy.ts`'s `TENTACLE_PIVOT`), not a function call, since `render/creature-layer.tsx` reads it from a per-frame worklet. */
export const ANTENNA_PIVOT: XY = (() => {
  const s = spineAt(ANTENNA_PIVOT_U);
  const hw = bodyHalfHeightAt(ANTENNA_PIVOT_U);
  return { x: s.point.x + s.normal.x * hw * 0.35, y: s.point.y + s.normal.y * hw * 0.35 };
})();

/** Deterministic — every variant shares the same body shape (see `snail/anatomy.ts`'s identical precedent); only `pigment.ts` varies per variant. */
export function buildShrimpAnatomy(): ShrimpAnatomy {
  const bodyD = ribbonAlongPath({
    uStart: 0,
    uEnd: 1,
    at: spineAt,
    halfWidth: bodyHalfHeightAt,
    samples: 64,
  });

  // Rostrum: a slender forward beak, slightly upturned, rooted inside the
  // carapace so the body fill buries its base.
  const head = spinePoint(0);
  const rostrumTip: XY = { x: head.x + 16, y: head.y - 6.5 };
  const F = (n: number) => n.toFixed(1);
  const rostrumD =
    `M ${F(head.x - 6)} ${F(head.y - 4.2)} ` +
    `L ${F(rostrumTip.x)} ${F(rostrumTip.y)} ` +
    `L ${F(head.x - 5)} ${F(head.y + 2.6)} Z`;

  // Five walking legs off the thorax belly, each JOINTED (thigh + shin, two
  // chained tapers) and angled FORWARD to the foot — a straight vertical
  // dowel reads as a table leg, and the forward rake is what the reference
  // art shows. Every foot lands on y = 0 exactly (not merely hip-relative),
  // which IS the sole line this species is bound to — a leg that stopped
  // short would leave the shrimp hovering. Thin: at tank scale these are a
  // delicate fringe, not structure.
  const legUs = [0.2, 0.29, 0.38, 0.47, 0.56];
  const legs: ChainCircle[][] = legUs.map((u) => {
    const s = spineAt(u);
    const hw = bodyHalfHeightAt(u);
    const hip: XY = {
      x: s.point.x - s.normal.x * hw * 0.85,
      y: s.point.y - s.normal.y * hw * 0.85,
    };
    const knee: XY = { x: hip.x - 2.2, y: hip.y * 0.42 };
    const foot: XY = { x: hip.x + 2.6, y: 0 };
    return [...circleChain(hip, 1.6, knee, 1.1), ...circleChain(knee, 1.1, foot, 0.8)];
  });

  // Swimmerets: the small paddle pairs under the abdomen. Short, fine, and
  // clear of the ground — they fill the gap between the last walking leg and
  // the tail fan, and stop the abdomen reading as a bare tube.
  const swimmeretUs = [0.64, 0.73, 0.82, 0.91];
  const swimmerets: ChainCircle[][] = swimmeretUs.map((u) => {
    const s = spineAt(u);
    const hw = bodyHalfHeightAt(u);
    const hip: XY = { x: s.point.x - s.normal.x * hw * 0.7, y: s.point.y - s.normal.y * hw * 0.7 };
    const tip: XY = { x: hip.x + 2.6, y: hip.y + 4.6 };
    return circleChain(hip, 1.2, tip, 0.6);
  });

  const eyeU = 0.09;
  const eyeRadius = 4.6;
  const eyeSpine = spineAt(eyeU);
  const eyeHw = bodyHalfHeightAt(eyeU);
  const eye: XY = {
    x: eyeSpine.point.x + eyeSpine.normal.x * eyeHw * 0.25,
    y: eyeSpine.point.y + eyeSpine.normal.y * eyeHw * 0.25,
  };

  const p = ANTENNA_PIVOT;
  // Two long antennae sweeping BACK over the body (the real arrangement, and
  // what the reference art shows), plus two short forward antennules. Far
  // members of each pair first so they draw behind their partner.
  const antennae: Antenna[] = [
    buildAntenna(p, { x: p.x - 20, y: p.y - 20 }, { x: p.x - 48, y: p.y - 27 }, 1.9, 0.25, true),
    buildAntenna(p, { x: p.x - 26, y: p.y - 15 }, { x: p.x - 64, y: p.y - 16 }, 2.1, 0.3, true),
    buildAntenna(p, { x: p.x + 9, y: p.y + 2 }, { x: p.x + 17, y: p.y + 7 }, 1.5, 0.25, false),
    buildAntenna(p, { x: p.x + 10, y: p.y - 4 }, { x: p.x + 19, y: p.y - 5 }, 1.6, 0.25, false),
  ];

  // Fan around the spine's OWN tangent at the tail, so it trails the curve
  // instead of sticking out at a hardcoded angle.
  const tailEnd = spinePoint(1);
  const tailNormal = spineAt(1).normal;
  const tangentDeg = (Math.atan2(-tailNormal.x, tailNormal.y) * 180) / Math.PI;
  const tailFanD = [
    finBladeD(tailEnd, tangentDeg - 15, 17, 4.2),
    finBladeD(tailEnd, tangentDeg, 21, 4.8),
    finBladeD(tailEnd, tangentDeg + 15, 17, 4.2),
  ];

  const limbPoints = [...legs, ...swimmerets].flat().flatMap((c) => [
    { x: c.cx - c.r, y: c.cy - c.r },
    { x: c.cx + c.r, y: c.cy + c.r },
  ]);
  const bodyBounds = padBox(
    unionPoints([
      ...pathPoints(bodyD),
      ...pathPoints(rostrumD),
      ...limbPoints,
      { x: eye.x - eyeRadius, y: eye.y - eyeRadius },
      { x: eye.x + eyeRadius, y: eye.y + eyeRadius },
      ...tailFanD.flatMap(pathPoints),
    ]),
    3,
  );
  const antennaeBounds = padBox(unionPoints([...antennae.flatMap((a) => pathPoints(a.d)), p]), 3);

  return {
    bodyD,
    rostrumD,
    rostrumTip,
    eye,
    eyeRadius,
    legs,
    swimmerets,
    tailFanD,
    antennae,
    bodyBounds,
    antennaeBounds,
    bounds: unionBoxes(bodyBounds, antennaeBounds),
  };
}
