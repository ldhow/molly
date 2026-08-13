// Turtle body plan: a domed oval shell (a plain smooth ellipse — see
// `frog/anatomy.ts`'s header for why a whole-body silhouette avoids
// `blobPath`'s seam corner), a small head peeking from the front, and four
// flat flipper-paddle legs peeking from under the shell rim. No independent
// paddle-stroke animation (per the plan's Cut list) — static geometry on a
// swim-transformed sprite, same as every other rigid creature.
//
// Dependency-free: no React/RN/Skia imports. Runs under plain Node.

import type { Box, XY } from "@/shared/aquarium/core/ir";

const SHELL_RX = 27;
const SHELL_RY = 20;

function ellipsePathD(cx: number, cy: number, rx: number, ry: number): string {
  const F = (n: number) => n.toFixed(1);
  return (
    `M ${F(cx - rx)} ${F(cy)} ` +
    `A ${F(rx)} ${F(ry)} 0 1 0 ${F(cx + rx)} ${F(cy)} ` +
    `A ${F(rx)} ${F(ry)} 0 1 0 ${F(cx - rx)} ${F(cy)} Z`
  );
}

/** A flat paddle — a tapered leaf shape, not a chain of circles (a turtle's flipper reads as one flat plate, unlike a frog's rounded jointed leg). */
function paddlePathD(root: XY, tip: XY, width: number): string {
  const dx = tip.x - root.x;
  const dy = tip.y - root.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const mid = { x: root.x + dx * 0.55, y: root.y + dy * 0.55 };
  const F = (n: number) => n.toFixed(1);
  return (
    `M ${F(root.x)} ${F(root.y)} ` +
    `Q ${F(mid.x + nx * width)} ${F(mid.y + ny * width)} ${F(tip.x)} ${F(tip.y)} ` +
    `Q ${F(mid.x - nx * width)} ${F(mid.y - ny * width)} ${F(root.x)} ${F(root.y)} Z`
  );
}

export interface TurtleAnatomy {
  shellD: string;
  headD: string;
  paddles: { d: string; behindShell: boolean }[];
  eyeL: XY;
  eyeR: XY;
  bounds: Box;
}

/** Deterministic — every variant shares the same body shape (see `snail/anatomy.ts`'s identical precedent); only `pigment.ts` varies per variant. */
export function buildTurtleAnatomy(): TurtleAnatomy {
  const shellD = ellipsePathD(0, 0, SHELL_RX, SHELL_RY);

  const headCx = -SHELL_RX * 1.12;
  const headD = ellipsePathD(headCx, -1, 9, 7.5);
  const eyeL: XY = { x: headCx - 3, y: -4.5 };
  const eyeR: XY = { x: headCx - 3, y: 2 };

  // Four paddles peeking from under the shell rim — front pair angled
  // forward, back pair angled backward, all drawn short enough that most of
  // each paddle stays hidden under the shell (only the tip reads as visible
  // "peeking out", matching the plan's own phrasing).
  const paddles = [
    {
      d: paddlePathD(
        { x: -SHELL_RX * 0.55, y: -SHELL_RY * 0.85 },
        { x: -SHELL_RX * 0.95, y: -SHELL_RY * 1.35 },
        5,
      ),
      behindShell: true,
    },
    {
      d: paddlePathD(
        { x: SHELL_RX * 0.55, y: -SHELL_RY * 0.85 },
        { x: SHELL_RX * 0.95, y: -SHELL_RY * 1.3 },
        5,
      ),
      behindShell: true,
    },
    {
      d: paddlePathD(
        { x: -SHELL_RX * 0.55, y: SHELL_RY * 0.85 },
        { x: -SHELL_RX * 0.85, y: SHELL_RY * 1.3 },
        5.5,
      ),
      behindShell: false,
    },
    {
      d: paddlePathD(
        { x: SHELL_RX * 0.55, y: SHELL_RY * 0.85 },
        { x: SHELL_RX * 0.85, y: SHELL_RY * 1.3 },
        5.5,
      ),
      behindShell: false,
    },
  ];

  const minX = Math.min(-SHELL_RX, headCx - 9) - 4;
  const maxX = Math.max(SHELL_RX, SHELL_RX * 0.95) + 4;
  const minY = Math.min(-SHELL_RY, -SHELL_RY * 1.35) - 4;
  const maxY = Math.max(SHELL_RY, SHELL_RY * 1.3) + 4;
  const bounds: Box = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };

  return { shellD, headD, paddles, eyeL, eyeR, bounds };
}
