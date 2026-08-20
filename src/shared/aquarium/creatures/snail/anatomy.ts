// Snail body plan — a SIDE-PROFILE crawler, not a top-down spiral.
//
// The old build drew the shell face-on (a bullseye) with a foot ellipse
// pasted beside it, which only reads as a snail if you already know it is
// one, and it had no notion of which way is "down". A snail never swims: it
// glides on a surface (see `sim/crawl.ts`), so its art has to be authored in
// a frame where the surface is a known axis.
//
// LOCAL FRAME (the contract `sim/crawl.ts` + `render/creature-layer.tsx`
// rely on, and `scripts/verify-aquarium.ts` asserts):
//
//   - the sole's contact line is y = 0, and nothing meaningful sits below it
//   - +x is FORWARD (the direction of travel); the head is at +x
//   - -y is UP, away from the surface the snail is stuck to
//
// so placing a snail on any surface is `translate(contactPoint)` +
// `rotate(surfaceAngle)` + `scaleX(±1)` — no per-surface art, no offsets to
// keep in sync. A snail on the ceiling is the same texture rotated 180°.
//
// The shell is still traced with `ribbonAlongPath` (core/pigment-toolkit.ts)
// along a logarithmic-spiral centerline — a spiral tube's outer boundary
// genuinely IS a ribbon-along-a-path — but the spiral is now SQUASHED and
// ROTATED into place so the coil reads as seen from the side, with its
// aperture (the shell's mouth) opening forward-down, over the neck, where a
// real snail's body actually emerges. `shellAt()` returns already-placed
// points so `pigment.ts`'s whorl bands trace the exact same coil the outline
// does.
//
// Dependency-free: no React/RN/Skia imports. Runs under plain Node.

import type { Box, XY } from "@/shared/aquarium/core/ir";
import { ribbonAlongPath, toRad } from "@/shared/aquarium/core/pigment-toolkit";

const F = (n: number) => n.toFixed(1);

// ---------------------------------------------------------------------------
// Shell — a log spiral, squashed, rotated, and hung off its own aperture.
// ---------------------------------------------------------------------------

/** Full turns the coil makes — a real mystery/nerite shell is ~2-2.5 whorls. */
const WRAPS = 2.2;
const THETA_MAX = WRAPS * Math.PI * 2;
/** Apex radius and per-turn growth: together these set how flared vs. conical the coil reads. */
const R0 = 1.45;
const GROWTH_PER_TURN = 2.28;
/** Whorl tube half-width as a fraction of that whorl's radius. >0.5 means each turn overlaps the previous one, the real "spirals outward covering its own earlier turns" look. */
const TUBE_RATIO = 0.58;
/** Vertical squash of the coil BEFORE it is rotated into place — a circular spiral reads as a target seen dead-on; a squashed one reads as a coil seen at a shallow angle, which is what a side-on snail actually shows. */
const Y_SQUASH = 0.8;
/** Rotation applied to the whole coil. Tuned so the aperture opens forward-and-down (over the neck) and the apex tips back over the tail. */
const SHELL_ROT = toRad(-97);
/** Where the aperture's centre lands in the body frame — the shell is positioned BY ITS MOUTH, since that is the one point that has to agree with the foot. */
const APERTURE: XY = { x: 11.5, y: -14.6 };

const ROT_COS = Math.cos(SHELL_ROT);
const ROT_SIN = Math.sin(SHELL_ROT);

function spiralRaw(theta: number): XY {
  const r = R0 * Math.pow(GROWTH_PER_TURN, theta / (Math.PI * 2));
  return { x: r * Math.cos(theta), y: r * Math.sin(theta) * Y_SQUASH };
}

function rotate(p: XY): XY {
  return { x: p.x * ROT_COS - p.y * ROT_SIN, y: p.x * ROT_SIN + p.y * ROT_COS };
}

/** Translation that puts the coil's rim exactly at `APERTURE`. */
const SHELL_OFFSET: XY = (() => {
  const rim = rotate(spiralRaw(THETA_MAX));
  return { x: APERTURE.x - rim.x, y: APERTURE.y - rim.y };
})();

export function shellRadiusAt(theta: number): number {
  return R0 * Math.pow(GROWTH_PER_TURN, theta / (Math.PI * 2));
}

function shellCenterlinePoint(theta: number): XY {
  const p = rotate(spiralRaw(theta));
  return { x: p.x + SHELL_OFFSET.x, y: p.y + SHELL_OFFSET.y };
}

/**
 * Whether the tangent's left normal points AWAY from the coil's centre.
 * Which way `(-dy, dx)` faces depends on the spiral's winding direction and
 * on `SHELL_ROT`, so it is measured once rather than assumed — get it
 * backwards and "outer edge" silently means "inner edge", which collapses
 * the silhouette to a sliver instead of failing loudly.
 */
const NORMAL_SIGN: 1 | -1 = (() => {
  const theta = THETA_MAX;
  const p0 = shellCenterlinePoint(theta);
  const p1 = shellCenterlinePoint(theta + 0.002);
  const nx = -(p1.y - p0.y);
  const ny = p1.x - p0.x;
  const outX = p0.x - SHELL_OFFSET.x;
  const outY = p0.y - SHELL_OFFSET.y;
  return nx * outX + ny * outY >= 0 ? 1 : -1;
})();

/** Point + outward normal at `u` (`u=0` the apex, `u=1` the aperture), already placed in the body frame — shared with `pigment.ts` so whorl bands trace the exact spiral the outline does. */
export function shellAt(u: number): { point: XY; normal: XY } {
  const theta = u * THETA_MAX;
  const eps = 0.002;
  const p0 = shellCenterlinePoint(theta);
  const p1 = shellCenterlinePoint(theta + eps);
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const len = (Math.hypot(dx, dy) || 1) * NORMAL_SIGN;
  return { point: p0, normal: { x: -dy / len, y: dx / len } };
}

export function shellHalfWidthAt(u: number): number {
  return shellRadiusAt(u * THETA_MAX) * TUBE_RATIO;
}

/** `u` at which the outermost whorl begins — one full turn back from the aperture. */
export const OUTER_TURN_U = 1 - 1 / WRAPS;

export function shellOuterEdge(u: number): XY {
  const { point, normal } = shellAt(u);
  const hw = shellHalfWidthAt(u);
  return { x: point.x + normal.x * hw, y: point.y + normal.y * hw };
}

export function shellInnerEdge(u: number): XY {
  const { point, normal } = shellAt(u);
  const hw = shellHalfWidthAt(u);
  return { x: point.x - normal.x * hw, y: point.y - normal.y * hw };
}

/**
 * The coil's SILHOUETTE — deliberately not the full spiral ribbon.
 *
 * A ribbon traced along 2+ turns of a log spiral overlaps itself, and Skia
 * fills paths by winding number: the overlaps cancel, so the shell renders
 * as a translucent target you can see the body through. The union of the
 * tube is also just its outermost whorl anyway (each turn grows by
 * `GROWTH_PER_TURN` > 1 + 2 * `TUBE_RATIO`, so every earlier turn is fully
 * covered), so the outline is exactly:
 *
 *   outer edge of the last turn -> rounded aperture lip -> a short radial
 *   step back to where that last turn started
 *
 * which is a simple closed curve with no self-intersection. The whorls
 * INSIDE it are drawn by `pigment.ts` as marks on this fill (the seam line
 * and per-turn bands), which is also how a real shell shows them: as
 * surface, not as separate silhouettes. The radial step is the aperture
 * lip's own edge — real shells have exactly that notch.
 */
function buildShellD(): string {
  const samples = 72;
  const start = shellOuterEdge(OUTER_TURN_U);
  let d = `M ${F(start.x)} ${F(start.y)}`;
  for (let i = 1; i <= samples; i++) {
    const u = OUTER_TURN_U + (1 - OUTER_TURN_U) * (i / samples);
    const p = shellOuterEdge(u);
    d += ` L ${F(p.x)} ${F(p.y)}`;
  }
  const capR = shellHalfWidthAt(1);
  const lip = shellInnerEdge(1);
  d += ` A ${F(capR)} ${F(capR)} 0 0 1 ${F(lip.x)} ${F(lip.y)}`;
  return d + " Z";
}

// ---------------------------------------------------------------------------
// Foot — the muscular sole the whole creature rides on.
// ---------------------------------------------------------------------------

/** Rearmost point of the foot (the tail's trailing tip). */
const TAIL_X = -21.5;
/** Frontmost point of the head. */
const HEAD_X = 27;
/** How far the sole's pedal ripples deviate from the contact line. Purely a texture cue — the sole itself never leaves y=0 (see `SOLE_Y`). */
const SOLE_RIPPLE = 0.75;
const SOLE_RIPPLES = 6;
/** The sole rides a hair above y=0 so the ripple troughs, not the crests, are what touch the surface. */
const SOLE_Y = -0.85;

/** Sole ripple height at a given x — exported so `pigment.ts` can put the pale foot-fringe highlight on the same wave the outline uses. */
export function soleAt(x: number): number {
  const t = (x - TAIL_X) / (HEAD_X - TAIL_X);
  // Fade the ripples out at both ends so the sole meets the tail tip and the
  // front lip cleanly instead of ending mid-crest.
  const fade = Math.sin(Math.PI * Math.min(1, Math.max(0, t))) ** 0.6;
  return SOLE_Y + Math.sin(t * Math.PI * 2 * SOLE_RIPPLES) * SOLE_RIPPLE * fade;
}

/** Chains sampled points through their midpoints as quadratics — smooth, no visible faceting, same trick `blobPath` uses. */
function smoothThrough(points: XY[]): string {
  let d = "";
  for (let i = 1; i < points.length; i++) {
    const p0 = points[i - 1];
    const p1 = points[i];
    d += ` Q ${F(p0.x)} ${F(p0.y)} ${F((p0.x + p1.x) / 2)} ${F((p0.y + p1.y) / 2)}`;
  }
  const last = points[points.length - 1];
  return d + ` L ${F(last.x)} ${F(last.y)}`;
}

const SOLE_FRONT_X = 24.2;
const SOLE_BACK_X = -19.6;

function soleTraceBack(): string {
  const samples = 44;
  const pts: XY[] = [];
  for (let i = 0; i <= samples; i++) {
    const x = SOLE_FRONT_X + (SOLE_BACK_X - SOLE_FRONT_X) * (i / samples);
    pts.push({ x, y: soleAt(x) });
  }
  return smoothThrough(pts);
}

/**
 * The foot outline, traced forward along the back (tail -> neck -> head dome)
 * and then back along the rippled sole. The upper-middle stretch is drawn
 * even though the shell covers it: an opaque foot under an opaque shell is
 * the same "buried root" rule `fish/bake-fish.ts` uses for fin roots, and it
 * means the shell can be nudged without opening a hole in the body.
 */
function buildFootD(): string {
  return (
    `M ${F(TAIL_X)} -3.2 ` +
    `C -18.0 -8.4, -10.0 -11.4, -2.0 -12.5 ` + // low arch under the shell
    `C 4.5 -13.4, 9.5 -13.8, 13.5 -13.8 ` + // neck: a shallow dip between shell and head
    `C 17.6 -13.8, 20.4 -18.0, 23.4 -17.8 ` + // head rises
    `C 26.0 -17.6, ${F(HEAD_X)} -14.6, 26.6 -11.2 ` + // head dome, front
    `C 26.2 -7.6, 25.4 -4.4, ${F(SOLE_FRONT_X)} ${F(soleAt(SOLE_FRONT_X))}` + // front lip
    soleTraceBack() +
    ` C -20.6 -1.2, -21.4 -2.0, ${F(TAIL_X)} -3.2 Z`
  );
}

// ---------------------------------------------------------------------------
// Tentacles — baked SEPARATELY so they can sway (see creature-layer.tsx).
// ---------------------------------------------------------------------------

/** Rotation pivot for the tentacle sway. Sits inside the head dome, so a few degrees of swing never opens a seam at the roots. */
export const TENTACLE_PIVOT: XY = { x: 23.5, y: -13.6 };

interface Tentacle {
  /** Filled, tapered shaft. */
  d: string;
  /** Dark eye bulb (upper pair only). */
  tip: XY;
  tipR: number;
}

/** Quadratic Bezier point + normal at `u` — feeds `ribbonAlongPath`, so a tentacle is a tapered ribbon rather than a constant-width stroke. */
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

function buildTentacle(p0: XY, pc: XY, p1: XY, w0: number, w1: number, tipR: number): Tentacle {
  return {
    d: ribbonAlongPath({
      uStart: 0,
      uEnd: 1,
      at: quadAt(p0, pc, p1),
      halfWidth: (u) => (w0 + (w1 - w0) * u) / 2,
      samples: 16,
    }),
    tip: p1,
    tipR,
  };
}

export interface SnailAnatomy {
  shellD: string;
  footD: string;
  /** Aperture ellipse — the dark shell mouth the neck emerges from. */
  apertureD: string;
  /** Optical tentacles (eyes on stalks), far one first so it draws behind. */
  eyeStalks: [Tentacle, Tentacle];
  /** Short lower sensory tentacles, far one first. */
  feelers: [Tentacle, Tentacle];
  mouthD: string;
  /** Whorl count — `pigment.ts` sizes the whorl bands per TURN, not per unit `u`. */
  wraps: number;
  /** The sole's x span, so `pigment.ts`'s foot fringe rides exactly the stretch of sole the outline draws. */
  soleFrontX: number;
  soleBackX: number;
  /** Local-space bounds of the shell + foot only (NOT the tentacles — those bake separately). */
  bodyBounds: Box;
  /** Local-space bounds of the tentacles only. */
  tentacleBounds: Box;
  /** Union of both — what a whole-snail bake (preview, dead) covers. */
  bounds: Box;
}

/** Deterministic — every variant shares one body shape; only `pigment.ts` varies per variant (same precedent as `frog/anatomy.ts`). */
export function buildSnailAnatomy(): SnailAnatomy {
  const shellD = buildShellD();
  const footD = buildFootD();

  const rim = shellAt(1);
  const rimHw = shellHalfWidthAt(1);
  const apertureD = ellipseAlong(rim.point, rim.normal, rimHw * 0.94, rimHw * 0.34);

  // Far/near pairs: the far one is shorter and set back, which is what sells
  // two tentacles rather than one thick one once they overlap.
  const eyeStalks: [Tentacle, Tentacle] = [
    buildTentacle(
      { x: 20.6, y: -14.4 },
      { x: 24.5, y: -22.5 },
      { x: 29.4, y: -27.4 },
      2.1,
      1.5,
      1.7,
    ),
    buildTentacle(
      { x: 23.4, y: -14.8 },
      { x: 29.6, y: -21.6 },
      { x: 35.1, y: -25.2 },
      2.4,
      1.7,
      1.9,
    ),
  ];
  const feelers: [Tentacle, Tentacle] = [
    buildTentacle({ x: 25.2, y: -9.6 }, { x: 29.5, y: -8.6 }, { x: 32.4, y: -6.9 }, 1.5, 0.8, 0),
    buildTentacle({ x: 26.0, y: -7.6 }, { x: 30.6, y: -6.4 }, { x: 33.8, y: -4.4 }, 1.6, 0.9, 0),
  ];

  const mouthD = "M 26.6 -5.4 Q 28.4 -4.2 27.4 -2.6";

  const bodyBounds = padBox(unionPoints([...sampleShellHull(), ...sampleFootHull()]), 2.5);
  const tentacleBounds = padBox(
    unionPoints([
      ...eyeStalks.flatMap((t) => [
        { x: t.tip.x - t.tipR, y: t.tip.y - t.tipR },
        { x: t.tip.x + t.tipR, y: t.tip.y + t.tipR },
      ]),
      ...[...eyeStalks, ...feelers].flatMap((t) => pathPoints(t.d)),
      TENTACLE_PIVOT,
    ]),
    2.5,
  );

  return {
    shellD,
    footD,
    apertureD,
    wraps: WRAPS,
    soleFrontX: SOLE_FRONT_X,
    soleBackX: SOLE_BACK_X,
    eyeStalks,
    feelers,
    mouthD,
    bodyBounds,
    tentacleBounds,
    bounds: unionBoxes(bodyBounds, tentacleBounds),
  };
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Ellipse centred at `c`, its major axis along `axis` — the aperture is an oval seen edge-on, so it has to follow the rim's own normal, not the x axis. */
function ellipseAlong(c: XY, axis: XY, rx: number, ry: number): string {
  const n = 24;
  const ax = { x: axis.x, y: axis.y };
  const by = { x: -axis.y, y: axis.x };
  const pts: XY[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const u = Math.cos(a) * rx;
    const v = Math.sin(a) * ry;
    pts.push({ x: c.x + ax.x * u + by.x * v, y: c.y + ax.y * u + by.y * v });
  }
  let d = `M ${F(pts[0].x)} ${F(pts[0].y)}`;
  for (let i = 1; i <= n; i++) {
    const p0 = pts[(i - 1) % n];
    const p1 = pts[i % n];
    d += ` Q ${F(p0.x)} ${F(p0.y)} ${F((p0.x + p1.x) / 2)} ${F((p0.y + p1.y) / 2)}`;
  }
  return d + " Z";
}

/** The silhouette's own outer edge, for bounds — the coil is off-centre and overhangs its centreline, so a radius-based estimate would clip it (the previous build's did). */
function sampleShellHull(): XY[] {
  const pts: XY[] = [];
  for (let i = 0; i <= 96; i++)
    pts.push(shellOuterEdge(OUTER_TURN_U + (1 - OUTER_TURN_U) * (i / 96)));
  return pts;
}

function sampleFootHull(): XY[] {
  const pts: XY[] = [
    { x: TAIL_X, y: -3.4 },
    { x: HEAD_X, y: -18.2 },
    { x: HEAD_X, y: 0 },
    { x: TAIL_X, y: 0 },
  ];
  for (let i = 0; i <= 32; i++) {
    const x = SOLE_BACK_X + ((SOLE_FRONT_X - SOLE_BACK_X) * i) / 32;
    pts.push({ x, y: soleAt(x) });
  }
  return pts;
}

/** Every coordinate pair in a path `d` — good enough for bounds on the ribbon paths built above, whose control points ARE on the outline. */
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
