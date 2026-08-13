import { Skia, type SkPath } from "@shopify/react-native-skia";
import type { Species } from "./species";

/**
 * Worklet-safe geometry for procedural fish.
 *
 * Body-local space: nose at (0,0), fish faces +X, tail at (-L, 0).
 * Skia's canvas is y-down, so side = -1 is the fish's BACK (dorsal, drawn on
 * top) and side = +1 is the belly.
 *
 * Every exported function is a worklet. Helpers called from a worklet must
 * themselves be worklets, hence the directive on all of them.
 */

export const TWO_PI = Math.PI * 2;

/** Per-creature simulation state, packed into one Float32Array. */
export const STRIDE = 10;
export const S_X = 0;
export const S_Y = 1;
export const S_HEADING = 2;
export const S_SPEED = 3;
export const S_PHASE = 4;
export const S_WANDER = 5;
export const S_BURST = 6;
export const S_TURN = 7;
export const S_IDLE = 8;
export const S_AMP = 9;

/**
 * Each spine node is [x, y, tangentAngle, backDepth, bellyDepth].
 *
 * Back and belly are stored separately and deliberately. A single half-width
 * mirrored about the spine produces a sausage: real fish have a high arched
 * back and a flatter, further-aft belly bulge, and that asymmetry is most of
 * what makes a silhouette read as a fish at all.
 */
export const NODE = 5;

// ---------------------------------------------------------------- angles

/** Shortest signed representation of an angle, in [-PI, PI]. */
export const shortestAngle = (d: number) => {
  "worklet";
  let a = d;
  while (a > Math.PI) a -= TWO_PI;
  while (a < -Math.PI) a += TWO_PI;
  return a;
};

export const clamp = (v: number, lo: number, hi: number) => {
  "worklet";
  return v < lo ? lo : v > hi ? hi : v;
};

// ------------------------------------------------------ path API compat

/**
 * Skia 2.x uses an immutable path API (PathBuilder -> build()); older versions
 * use a mutable SkPath. These two helpers let the same drawing code run on both.
 */
export const newPathBuilder = (): any => {
  "worklet";
  const S = Skia as any;
  return S.PathBuilder ? S.PathBuilder.Make() : S.Path.Make();
};

export const finishPath = (b: any): SkPath => {
  "worklet";
  return typeof b.build === "function" ? b.build() : b;
};

// ---------------------------------------------------------------- shape

/** Linear sample of the width profile at normalized arc length s. */
export const sampleProfile = (widths: readonly number[], s: number) => {
  "worklet";
  const n = widths.length - 1;
  const x = clamp(s, 0, 1) * n;
  const i = Math.min(Math.floor(x), n - 1);
  const f = x - i;
  return widths[i] + (widths[i + 1] - widths[i]) * f;
};

/**
 * Fill `spine` with world-space vertebrae.
 *
 * The lateral offset is a traveling wave whose amplitude grows toward the tail,
 * plus an s^2 bend term so the body arcs into turns. Tangent angles come from
 * central differences, so fins hung off a vertebra inherit the wave for free.
 *
 * `spine` must have room for spec.segments * NODE floats. Allocate it once and
 * reuse it — allocating per frame is the main avoidable cost in this file.
 */
export const buildSpine = (
  spine: Float32Array,
  spec: Species,
  x: number,
  y: number,
  heading: number,
  phase: number,
  turnRate: number,
  scale: number,
  /** Undulation amplitude multiplier. Drops toward ~0.35 when a fish hovers. */
  ampScale: number = 1
) => {
  "worklet";
  const n = spec.segments;
  const L = spec.length * scale;
  const [a0, a1, a2] = spec.envelope;
  const ca = Math.cos(heading);
  const sa = Math.sin(heading);

  // Pass 1: local-space positions, stored temporarily in the x/y slots.
  //
  // Vertebrae are placed by ARC LENGTH, not at fixed x. Laying them out at
  // x = -s*L and adding a lateral wave silently stretches the body by 5-10%
  // at full swing (measured), so the fish visibly grows and shrinks as its
  // tail beats. Stepping a fixed segment length along the curve instead keeps
  // total spine length exactly L, and correctly shortens the nose-to-tail
  // span when the body curves — which is what a real bending fish does.
  const seg = L / (n - 1);
  const lateral = (s: number) => {
    "worklet";
    const amp = (a0 + a1 * s + a2 * s * s) * L * ampScale;
    // The turn bend is NOT scaled by ampScale: a hovering fish still curves its
    // body to turn, it just stops beating its tail.
    return amp * Math.sin((TWO_PI * s) / spec.wavelength - phase)
      + turnRate * L * s * s * spec.turnStiffness;
  };
  spine[0] = 0;
  spine[1] = lateral(0);
  for (let i = 1; i < n; i++) {
    const y2 = lateral(i / (n - 1));
    const dy = y2 - spine[(i - 1) * NODE + 1];
    // Clamp guards against an over-large amplitude asking for a step longer
    // than the segment itself.
    const dx = Math.sqrt(Math.max(0, seg * seg - dy * dy));
    spine[i * NODE] = spine[(i - 1) * NODE] - dx;
    spine[i * NODE + 1] = y2;
  }

  // Pass 2: tangents from central differences. This MUST finish before any
  // position is rewritten — mixing local and world coordinates in the same
  // difference produces garbage angles and a fish that turns inside out.
  for (let i = 0; i < n; i++) {
    const p = i === 0 ? 0 : i - 1;
    const q = i === n - 1 ? n - 1 : i + 1;
    const dx = spine[p * NODE] - spine[q * NODE];
    const dy = spine[p * NODE + 1] - spine[q * NODE + 1];
    spine[i * NODE + 2] = Math.atan2(dy, dx) + heading;
  }

  // Pass 3: rotate/translate into world space and sample widths.
  for (let i = 0; i < n; i++) {
    const lx = spine[i * NODE];
    const ly = spine[i * NODE + 1];
    spine[i * NODE] = x + lx * ca - ly * sa;
    spine[i * NODE + 1] = y + lx * sa + ly * ca;
    const s = i / (n - 1);
    spine[i * NODE + 3] = sampleProfile(spec.backs ?? spec.widths, s) * L;
    spine[i * NODE + 4] = sampleProfile(spec.bellies ?? spec.widths, s) * L;
  }
};

/** Point offset perpendicular from vertebra `i`. side: -1 back, +1 belly. */
/** side -1 = back (dorsal), +1 = belly (ventral) in Skia's y-down canvas. */
export const ribDepth = (spine: Float32Array, i: number, side: number) => {
  "worklet";
  return side < 0 ? spine[i * NODE + 3] : spine[i * NODE + 4];
};

export const ribX = (spine: Float32Array, i: number, side: number, extra: number) => {
  "worklet";
  const a = spine[i * NODE + 2];
  return spine[i * NODE] + Math.cos(a + (side * Math.PI) / 2) * (ribDepth(spine, i, side) + extra);
};

export const ribY = (spine: Float32Array, i: number, side: number, extra: number) => {
  "worklet";
  const a = spine[i * NODE + 2];
  return spine[i * NODE + 1] + Math.sin(a + (side * Math.PI) / 2) * (ribDepth(spine, i, side) + extra);
};

// ------------------------------------------------------------- smoothing

/**
 * Catmull-Rom through `count` points (flat [x,y,...]), emitted as cubic Béziers.
 * Skia has no curveVertex equivalent, so this is how you get a smooth outline.
 */
export const catmullToPath = (b: any, pts: number[], count: number, closed: boolean) => {
  "worklet";
  if (count < 3) return;
  b.moveTo(pts[0], pts[1]);
  const segs = closed ? count : count - 1;
  for (let i = 0; i < segs; i++) {
    const i0 = (((i - 1) % count) + count) % count;
    const i1 = i % count;
    const i2 = (i + 1) % count;
    const i3 = (i + 2) % count;
    const p0x = pts[i0 * 2], p0y = pts[i0 * 2 + 1];
    const p1x = pts[i1 * 2], p1y = pts[i1 * 2 + 1];
    const p2x = pts[i2 * 2], p2y = pts[i2 * 2 + 1];
    const p3x = pts[i3 * 2], p3y = pts[i3 * 2 + 1];
    b.cubicTo(
      p1x + (p2x - p0x) / 6, p1y + (p2y - p0y) / 6,
      p2x - (p3x - p1x) / 6, p2y - (p3y - p1y) / 6,
      p2x, p2y
    );
  }
  if (closed) b.close();
};

// ------------------------------------------------------------- body + fins

/** Closed body outline: belly side nose->tail, tail cap, back side tail->nose, nose cap. */
export const buildBodyPath = (spine: Float32Array, spec: Species, out: number[]): SkPath => {
  "worklet";
  const n = spec.segments;
  let k = 0;
  for (let i = 0; i < n; i++) {
    out[k++] = ribX(spine, i, 1, 0);
    out[k++] = ribY(spine, i, 1, 0);
  }
  const ta = spine[(n - 1) * NODE + 2];
  const tw = spine[(n - 1) * NODE + 3];
  out[k++] = spine[(n - 1) * NODE] + Math.cos(ta + Math.PI) * tw * 0.6;
  out[k++] = spine[(n - 1) * NODE + 1] + Math.sin(ta + Math.PI) * tw * 0.6;
  for (let i = n - 1; i >= 0; i--) {
    out[k++] = ribX(spine, i, -1, 0);
    out[k++] = ribY(spine, i, -1, 0);
  }
  // Head. A wedge, not a dome: brow -> snout tip -> chin. A symmetric rounded
  // cap makes every species look like the same blunt tube, and the head is
  // where most of the species read lives.
  const ha = spine[2];
  const wb = spine[3];
  const wl = spine[4];
  const hx = spine[0];
  const hy = spine[1];
  const snout = (wb + wl) * 0.6 * spec.noseRound;
  const brow = spec.headTaper ?? 0.55;
  out[k++] = hx + Math.cos(ha - brow) * wb * 1.02;
  out[k++] = hy + Math.sin(ha - brow) * wb * 1.02;
  out[k++] = hx + Math.cos(ha - 0.16) * snout;
  out[k++] = hy + Math.sin(ha - 0.16) * snout;
  out[k++] = hx + Math.cos(ha + 0.2) * snout * 0.94;
  out[k++] = hy + Math.sin(ha + 0.2) * snout * 0.94;
  out[k++] = hx + Math.cos(ha + brow * 1.35) * wl * 0.98;
  out[k++] = hy + Math.sin(ha + brow * 1.35) * wl * 0.98;

  const b = newPathBuilder();
  catmullToPath(b, out, k / 2, true);
  return finishPath(b);
};

const NOTCH: Record<string, number> = { fork: 0.45, fan: 0.92, veil: 0.75, lyre: 0.3 };

/**
 * Caudal fin. Base straddles the SECOND-TO-LAST vertebra so the fin merges into
 * the peduncle; anchoring it to the last one leaves a visible gap on hard swings.
 */
export const buildCaudalPath = (spine: Float32Array, spec: Species, scale: number, out: number[]): SkPath => {
  "worklet";
  const n = spec.segments;
  const i = n - 1;
  const x = spine[i * NODE];
  const y = spine[i * NODE + 1];
  const back = spine[i * NODE + 2] + Math.PI;
  const L = spec.caudal.length * spec.length * scale;
  const sp = spec.caudal.spread;
  const notch = NOTCH[spec.caudal.type] ?? 0.6;
  const lower = spec.caudal.type === "veil" ? 1.15 : 1;

  let k = 0;
  out[k++] = ribX(spine, i - 1, -1, 0); out[k++] = ribY(spine, i - 1, -1, 0);
  out[k++] = x + Math.cos(back - sp) * L; out[k++] = y + Math.sin(back - sp) * L;
  out[k++] = x + Math.cos(back) * L * notch; out[k++] = y + Math.sin(back) * L * notch;
  out[k++] = x + Math.cos(back + sp) * L * lower; out[k++] = y + Math.sin(back + sp) * L * lower;
  out[k++] = ribX(spine, i - 1, 1, 0); out[k++] = ribY(spine, i - 1, 1, 0);

  const b = newPathBuilder();
  catmullToPath(b, out, k / 2, true);
  return finishPath(b);
};

/**
 * Dorsal (side -1) or anal (side +1) fin. Follows the spine, so it deforms with
 * the body instead of sitting on it like a sticker.
 */
export const buildCrestPath = (
  spine: Float32Array,
  spec: Species,
  fin: { span: readonly [number, number]; height: number; peak: number },
  side: number,
  scale: number,
  out: number[]
): SkPath => {
  "worklet";
  const n = spec.segments;
  const i0 = Math.max(0, Math.round(fin.span[0] * (n - 1)));
  const i1 = Math.min(n - 1, Math.round(fin.span[1] * (n - 1)));
  if (i1 <= i0) return finishPath(newPathBuilder());
  const h = fin.height * spec.length * scale;
  const k0 = Math.log(0.5) / Math.log(fin.peak); // shifts the crest peak off-centre
  let k = 0;
  for (let i = i0; i <= i1; i++) {
    out[k++] = ribX(spine, i, side, 0);
    out[k++] = ribY(spine, i, side, 0);
  }
  for (let i = i1; i >= i0; i--) {
    const u = (i - i0) / (i1 - i0);
    const bump = Math.sin(Math.PI * Math.pow(u, k0));
    out[k++] = ribX(spine, i, side, h * bump);
    out[k++] = ribY(spine, i, side, h * bump);
  }
  const b = newPathBuilder();
  catmullToPath(b, out, k / 2, true);
  return finishPath(b);
};

/**
 * Pectoral fin: a rounded blade sculling at the shoulder. The two sides are
 * driven PI out of phase — in phase reads as a bird flapping, not a fish.
 */
export const buildPectoralPath = (
  spine: Float32Array,
  spec: Species,
  side: number,
  t: number,
  speedRatio: number,
  scale: number,
  out: number[]
): SkPath => {
  "worklet";
  const i = Math.round(spec.pectoral.at * (spec.segments - 1));
  const a = spine[i * NODE + 2];
  const w = spine[i * NODE + 3];
  const L = spec.pectoral.length * spec.length * scale;
  const phase = side > 0 ? 0 : Math.PI;
  // Hovering fish scull faster, not slower: rate rises as forward speed falls.
  const rate = spec.pectoral.rate * (1.6 - 0.6 * clamp(speedRatio, 0, 1));
  const flap = Math.sin(TWO_PI * rate * t + phase) * spec.pectoral.sweep;
  const root = Math.PI * 0.72 + flap;
  const hx = ribX(spine, i, side, -w * 0.15);
  const hy = ribY(spine, i, side, -w * 0.15);

  let k = 0;
  const put = (ang: number, r: number) => {
    "worklet";
    out[k++] = hx + Math.cos(a + side * ang) * r;
    out[k++] = hy + Math.sin(a + side * ang) * r;
  };
  put(Math.PI * 0.5, w * 0.25);
  put(root - 0.45, L * 0.72);
  put(root, L);
  put(root + 0.5, L * 0.55);

  const b = newPathBuilder();
  catmullToPath(b, out, k / 2, true);
  return finishPath(b);
};

/** Gill cover: a single arc behind the head. Cheap, and the head stops reading blank. */
export const buildGillPath = (spine: Float32Array, spec: Species): SkPath => {
  "worklet";
  const i = Math.max(1, Math.round(0.16 * (spec.segments - 1)));
  const b = newPathBuilder();
  const topX = ribX(spine, i, -1, 0);
  const topY = ribY(spine, i, -1, 0);
  const botX = ribX(spine, i, 1, 0);
  const botY = ribY(spine, i, 1, 0);
  const a = spine[i * NODE + 2];
  // Bow the arc backwards so it hugs the head rather than cutting straight down.
  const bulge = (spine[i * NODE + 3] + spine[i * NODE + 4]) * 0.32;
  b.moveTo(topX, topY);
  b.quadTo(
    (topX + botX) / 2 - Math.cos(a) * bulge,
    (topY + botY) / 2 - Math.sin(a) * bulge,
    botX, botY
  );
  return finishPath(b);
};

/** Mouth: a short line at the snout, angled slightly down. */
export const buildMouthPath = (spine: Float32Array, spec: Species): SkPath => {
  "worklet";
  const a = spine[2];
  const snout = (spine[3] + spine[4]) * 0.6 * spec.noseRound;
  const b = newPathBuilder();
  b.moveTo(spine[0] + Math.cos(a + 0.12) * snout * 0.92,
           spine[1] + Math.sin(a + 0.12) * snout * 0.92);
  b.quadTo(
    spine[0] + Math.cos(a + 0.5) * snout * 0.7,
    spine[1] + Math.sin(a + 0.5) * snout * 0.7,
    spine[0] + Math.cos(a + 1.0) * snout * 0.55,
    spine[1] + Math.sin(a + 1.0) * snout * 0.55
  );
  return finishPath(b);
};

/**
 * Counter-shading: the belly half of the body, inset toward the spine. Fill it
 * a few shades lighter. One extra path, and the fish gains form instead of
 * reading as a flat coloured shape.
 */
export const buildBellyPath = (
  spine: Float32Array, spec: Species, out: number[]
): SkPath => {
  "worklet";
  const n = spec.segments;
  let k = 0;
  for (let i = 0; i < n; i++) {
    out[k++] = ribX(spine, i, 1, 0);
    out[k++] = ribY(spine, i, 1, 0);
  }
  for (let i = n - 1; i >= 0; i--) {
    out[k++] = ribX(spine, i, 1, -ribDepth(spine, i, 1) * 0.55);
    out[k++] = ribY(spine, i, 1, -ribDepth(spine, i, 1) * 0.55);
  }
  const b = newPathBuilder();
  catmullToPath(b, out, k / 2, true);
  return finishPath(b);
};

/**
 * Caudal fin rays: thin spokes from the peduncle out to the trailing edge.
 * Stroke these over the fin at low alpha. A membrane with visible rays is what
 * reads as a real fin — a flat opaque shape is the single biggest giveaway that
 * a fish was drawn by code rather than an artist.
 */
export const buildCaudalRays = (
  spine: Float32Array, spec: Species, scale: number
): SkPath => {
  "worklet";
  const i = spec.segments - 1;
  const x = spine[i * NODE];
  const y = spine[i * NODE + 1];
  const back = spine[i * NODE + 2] + Math.PI;
  const L = spec.caudal.length * spec.length * scale;
  const sp = spec.caudal.spread;
  const notch = NOTCH[spec.caudal.type] ?? 0.6;
  const b = newPathBuilder();
  const RAYS = 5;
  for (let k = 0; k <= RAYS; k++) {
    const u = k / RAYS;
    const a = back - sp + u * 2 * sp;
    // Ray length follows the fin edge: full at the tips, `notch` at the middle.
    const edge = 1 - (1 - notch) * (1 - Math.abs(u * 2 - 1));
    b.moveTo(x, y);
    b.lineTo(x + Math.cos(a) * L * edge * 0.95, y + Math.sin(a) * L * edge * 0.95);
  }
  return finishPath(b);
};

/** Outer tip of the caudal fin — used as the far stop of the fin's alpha gradient. */
export const caudalTip = (spine: Float32Array, spec: Species, scale: number) => {
  "worklet";
  const i = spec.segments - 1;
  const back = spine[i * NODE + 2] + Math.PI;
  const L = spec.caudal.length * spec.length * scale;
  return {
    x: spine[i * NODE] + Math.cos(back) * L,
    y: spine[i * NODE + 1] + Math.sin(back) * L,
  };
};

/**
 * Eye: set back from the snout and lifted above the axis. Sitting it on the
 * nose tip (the naive placement) is instantly readable as wrong.
 */
export const eyeXY = (spine: Float32Array, spec: Species, side: number) => {
  "worklet";
  const a = spine[2];
  const wb = spine[3];
  const wl = spine[4];
  const snout = (wb + wl) * 0.6 * spec.noseRound;
  const back = spec.eyeAt ?? 0.42;
  return {
    x: spine[0] + Math.cos(a) * snout * back - Math.cos(a + Math.PI / 2) * wb * 0.34 * side,
    y: spine[1] + Math.sin(a) * snout * back - Math.sin(a + Math.PI / 2) * wb * 0.34 * side,
    r: Math.max(1.2, wb * 0.30),
  };
};
