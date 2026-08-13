// Snail body plan: a coiled shell (a spiral-tube ribbon, not a fish's
// single-valued top/bottom curve — this is exactly the case the plan's
// "Corrected: pigment/pattern reuse" note calls out) plus a small soft
// foot/body ellipse peeking from the shell's opening. No limbs.
//
// The shell is traced with `ribbonAlongPath` (core/pigment-toolkit.ts) along
// a logarithmic spiral centerline — the same generic ribbon helper
// `pigment.ts` doubles as the OUTLINE builder here, not just a coloring aid,
// since a spiral tube's outer boundary genuinely IS a ribbon-along-a-path.
//
// Dependency-free: no React/RN/Skia imports. Runs under plain Node.

import type { Box, XY } from "@/shared/aquarium/core/ir";
import { ribbonAlongPath } from "@/shared/aquarium/core/pigment-toolkit";

/** Number of full turns the shell coils through — a real garden/mystery snail shell is roughly 2-2.5 whorls. */
const WRAPS = 2.15;
const THETA_MAX = WRAPS * Math.PI * 2;
/** Innermost radius (the shell's apex) and how much the radius multiplies per full turn — controls how flared/conical the shell reads. */
const R0 = 3.2;
const GROWTH_PER_TURN = 2.3;
/** Whorl tube half-width as a fraction of that whorl's own radius — >0.5 means each new whorl overlaps (covers) more than half of the previous one, the real "shells spiral outward covering their own earlier turns" look. */
const TUBE_RATIO = 0.6;
/** Slight vertical squash — a spiral viewed dead-on reads as a target/bullseye; a squashed one reads as a shell seen at a shallow angle, which is what every 2D snail icon actually draws. */
const Y_SQUASH = 0.86;

export function shellRadiusAt(theta: number): number {
  return R0 * Math.pow(GROWTH_PER_TURN, theta / (Math.PI * 2));
}

function shellCenterlinePoint(theta: number): XY {
  const r = shellRadiusAt(theta);
  return { x: r * Math.cos(theta), y: r * Math.sin(theta) * Y_SQUASH };
}

/** Point + outward normal at `u` (`u=0` the shell's apex, `u=1` its rim) — shared with `pigment.ts` so whorl bands trace the exact same spiral the outline does. */
export function shellAt(u: number): { point: XY; normal: XY } {
  const theta = u * THETA_MAX;
  const eps = 0.002;
  const p0 = shellCenterlinePoint(theta);
  const p1 = shellCenterlinePoint(theta + eps);
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const len = Math.hypot(dx, dy) || 1;
  return { point: p0, normal: { x: -dy / len, y: dx / len } };
}

export function shellHalfWidthAt(u: number): number {
  return shellRadiusAt(u * THETA_MAX) * TUBE_RATIO;
}

export interface SnailAnatomy {
  shellD: string;
  footD: string;
  /** Where the shell's rim (its wide opening) sits — the foot peeks out from here. */
  opening: XY;
  eyeStalkBase: XY;
  bounds: Box;
}

export function buildSnailAnatomy(): SnailAnatomy {
  const shellD = ribbonAlongPath({
    uStart: 0,
    uEnd: 1,
    at: shellAt,
    halfWidth: shellHalfWidthAt,
    samples: 56,
  });

  const rim = shellAt(1).point;
  const rimR = shellRadiusAt(THETA_MAX);
  // The foot trails out from the shell's opening, down and away from the
  // coil's center — a real snail's body extends away from the shell mouth,
  // not underneath the whorls.
  const footCx = rim.x + rimR * 0.62;
  const footCy = rim.y + rimR * 0.5;
  const footRx = rimR * 0.95;
  const footRy = rimR * 0.5;
  const footD = ellipsePathD(footCx, footCy, footRx, footRy);

  const opening = { x: rim.x + rimR * 0.15, y: rim.y + rimR * 0.1 };
  const eyeStalkBase = { x: footCx + footRx * 0.55, y: footCy - footRy * 0.35 };

  const shellHalf = rimR * TUBE_RATIO;
  const bounds: Box = {
    x: Math.min(-shellHalf, footCx - footRx) - 2,
    y: Math.min(-shellHalf * Y_SQUASH, footCy - footRy) - 2,
    width: Math.max(shellHalf, footCx + footRx) - Math.min(-shellHalf, footCx - footRx) + 4,
    height:
      Math.max(shellHalf * Y_SQUASH, footCy + footRy) -
      Math.min(-shellHalf * Y_SQUASH, footCy - footRy) +
      4,
  };

  return { shellD, footD, opening, eyeStalkBase, bounds };
}

function ellipsePathD(cx: number, cy: number, rx: number, ry: number): string {
  const F = (n: number) => n.toFixed(1);
  return (
    `M ${F(cx - rx)} ${F(cy)} ` +
    `A ${F(rx)} ${F(ry)} 0 1 0 ${F(cx + rx)} ${F(cy)} ` +
    `A ${F(rx)} ${F(ry)} 0 1 0 ${F(cx - rx)} ${F(cy)} Z`
  );
}
