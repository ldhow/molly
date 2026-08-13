// Frog body plan: a rounded body (a soft blob, not a fish's elongated
// single-valued profile), two visible back legs as static bent-capsule
// geometry (see `limbs.ts` — no independent hop animation, per the plan's
// Cut list), and eyes on TOP of the head rather than the side — the one
// defining feature that reads as "frog" at a glance.
//
// Dependency-free: no React/RN/Skia imports. Runs under plain Node.

import type { Box, XY } from "@/shared/aquarium/core/ir";

import { buildBentLeg, type BentLeg } from "./limbs";

const BODY_RX = 24;
const BODY_RY = 19;

export interface FrogAnatomy {
  bodyD: string;
  legNear: BentLeg;
  legFar: BentLeg;
  eyeL: XY;
  eyeR: XY;
  eyeRadius: number;
  mouthD: string;
  bounds: Box;
}

/** Two-arc SVG ellipse, centered at `(cx, cy)` — `blobPath`'s wobble is meant for small decorative blobs; at its 7-point vertex count, its start/end seam reads as a visible corner on a shape this large (a whole body), so a plain smooth ellipse suits this better. */
function ellipsePathD(cx: number, cy: number, rx: number, ry: number): string {
  const F = (n: number) => n.toFixed(1);
  return (
    `M ${F(cx - rx)} ${F(cy)} ` +
    `A ${F(rx)} ${F(ry)} 0 1 0 ${F(cx + rx)} ${F(cy)} ` +
    `A ${F(rx)} ${F(ry)} 0 1 0 ${F(cx - rx)} ${F(cy)} Z`
  );
}

/** Deterministic — every variant shares the same body shape (see `snail/anatomy.ts`'s identical precedent); only `pigment.ts` varies per variant. */
export function buildFrogAnatomy(): FrogAnatomy {
  const bodyD = ellipsePathD(0, 2, BODY_RX, BODY_RY);

  // Splayed seated pose — one leg drawn behind the body (far), one in front
  // (near), so the body's opaque fill buries the far leg's hip root the
  // same "buried root" way `fish/bake-fish.ts` buries fin roots.
  const legFar = buildBentLeg({ x: -6, y: BODY_RY * 0.55 }, -1, 1);
  const legNear = buildBentLeg({ x: 8, y: BODY_RY * 0.55 }, 1, 1.05);

  const eyeRadius = 6.2;
  const eyeL: XY = { x: -8, y: -BODY_RY * 0.92 };
  const eyeR: XY = { x: 8, y: -BODY_RY * 0.92 };

  const mouthD = `M ${-11} ${1} Q 0 6 11 1`;

  const legSpanMinX = Math.min(legFar.footCenter.x, legNear.footCenter.x) - 8;
  const legSpanMaxX = Math.max(legFar.footCenter.x, legNear.footCenter.x) + 8;
  const legSpanMaxY = Math.max(legFar.footCenter.y, legNear.footCenter.y) + 6;

  const bounds: Box = {
    x: Math.min(-BODY_RX, eyeL.x - eyeRadius, legSpanMinX) - 4,
    y: Math.min(-BODY_RY, eyeL.y - eyeRadius) - 4,
    width:
      Math.max(BODY_RX, eyeR.x + eyeRadius, legSpanMaxX) -
      Math.min(-BODY_RX, eyeL.x - eyeRadius, legSpanMinX) +
      8,
    height: Math.max(BODY_RY, legSpanMaxY) - Math.min(-BODY_RY, eyeL.y - eyeRadius) + 8,
  };

  return { bodyD, legNear, legFar, eyeL, eyeR, eyeRadius, mouthD, bounds };
}
