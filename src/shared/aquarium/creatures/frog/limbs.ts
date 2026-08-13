// Static bent-leg geometry — a thigh segment and a shin segment, each a
// `circleChain` (core/limb-chain.ts) shrinking from hip to foot. Not
// independently animated (see the plan's Cut list: no hop-kick), just a
// fixed "sitting" pose baked once per bake, same as every other rigid
// creature's limbs.
//
// Dependency-free: no React/RN/Skia imports. Runs under plain Node.

import type { XY } from "@/shared/aquarium/core/ir";
import { circleChain, type ChainCircle } from "@/shared/aquarium/core/limb-chain";

export interface BentLeg {
  circles: ChainCircle[];
  footCenter: XY;
}

/** A seated back leg: hip -> knee -> foot, splayed outward at `sideSign` (-1 near/left, 1 far/right in local space). */
export function buildBentLeg(hip: XY, sideSign: number, scale: number): BentLeg {
  const knee: XY = { x: hip.x + sideSign * 10 * scale, y: hip.y + 6 * scale };
  const foot: XY = { x: hip.x + sideSign * 4 * scale, y: hip.y + 15 * scale };
  const toe: XY = { x: foot.x + sideSign * 6 * scale, y: foot.y + 1.5 * scale };

  const circles = [
    ...circleChain(hip, 6 * scale, knee, 4.5 * scale),
    ...circleChain(knee, 4.5 * scale, foot, 3.2 * scale),
    ...circleChain(foot, 3.2 * scale, toe, 2 * scale),
  ];

  return { circles, footCenter: foot };
}
