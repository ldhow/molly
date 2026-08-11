// SVG path parsing and flattening — turns the `d` strings in the fish IR into
// polylines that a software rasterizer (or a geometry builder) can consume.
//
// Dependency-free on purpose: this runs under plain Node for the preview and
// verification scripts, and inside the app for 3D texture baking.
//
// Supports the full command set (M L H V C Q S T A Z, absolute and relative).
// The fish art only uses M/L/C/Q/Z plus lowercase `q` and `a`, but the extra
// cases are a few lines each and mean this never silently drops geometry.

export interface Point {
  x: number;
  y: number;
}

/** A single closed or open run of points. One `d` can produce several. */
export type SubPath = Point[];

const CMD_ARGS: Record<string, number> = {
  m: 2,
  l: 2,
  h: 1,
  v: 1,
  c: 6,
  s: 4,
  q: 4,
  t: 2,
  a: 7,
  z: 0,
};

interface RawCommand {
  code: string;
  args: number[];
}

/** Split a `d` string into commands with their numeric arguments. */
export function parsePath(d: string): RawCommand[] {
  const out: RawCommand[] = [];
  // Numbers may be separated by spaces, commas, or nothing at all when the
  // sign or decimal point makes the boundary unambiguous (e.g. "10-5", ".5.5").
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g);
  if (!tokens) return out;

  let i = 0;
  let lastCode = "";
  while (i < tokens.length) {
    let code: string;
    if (/[a-zA-Z]/.test(tokens[i])) {
      code = tokens[i];
      i++;
    } else {
      // An implicit repeat: "M 0 0 10 10" means a second, implied command.
      // Repeated moveto becomes lineto, per the SVG spec.
      if (!lastCode) break;
      code = lastCode === "M" ? "L" : lastCode === "m" ? "l" : lastCode;
    }
    const n = CMD_ARGS[code.toLowerCase()] ?? 0;
    const args: number[] = [];
    for (let a = 0; a < n; a++) args.push(parseFloat(tokens[i++]));
    out.push({ code, args });
    lastCode = code;
  }
  return out;
}

function quadAt(p0: Point, p1: Point, p2: Point, t: number): Point {
  const s = 1 - t;
  return {
    x: s * s * p0.x + 2 * s * t * p1.x + t * t * p2.x,
    y: s * s * p0.y + 2 * s * t * p1.y + t * t * p2.y,
  };
}

function cubicAt(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const s = 1 - t;
  return {
    x: s * s * s * p0.x + 3 * s * s * t * p1.x + 3 * s * t * t * p2.x + t * t * t * p3.x,
    y: s * s * s * p0.y + 3 * s * s * t * p1.y + 3 * s * t * t * p2.y + t * t * t * p3.y,
  };
}

/** Rough curve length, used to pick a segment count proportional to size. */
function controlNetLength(pts: Point[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return len;
}

/** Endpoint-parameterised arc → centre form, per SVG's implementation notes. */
function arcToCubics(
  p0: Point,
  rxIn: number,
  ryIn: number,
  rotDeg: number,
  largeArc: boolean,
  sweep: boolean,
  p1: Point,
): Point[][] {
  if (p0.x === p1.x && p0.y === p1.y) return [];
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) return [[p0, p0, p1, p1]];

  const phi = (rotDeg * Math.PI) / 180;
  const cosP = Math.cos(phi);
  const sinP = Math.sin(phi);
  const dx2 = (p0.x - p1.x) / 2;
  const dy2 = (p0.y - p1.y) / 2;
  const x1p = cosP * dx2 + sinP * dy2;
  const y1p = -sinP * dx2 + cosP * dy2;

  // Scale radii up if they're too small to span the endpoints.
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }

  const sign = largeArc !== sweep ? 1 : -1;
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = sign * Math.sqrt(Math.max(0, num / den));
  const cxp = (co * (rx * y1p)) / ry;
  const cyp = (co * -(ry * x1p)) / rx;
  const cx = cosP * cxp - sinP * cyp + (p0.x + p1.x) / 2;
  const cy = sinP * cxp + cosP * cyp + (p0.y + p1.y) / 2;

  const angleOf = (ux: number, uy: number) => Math.atan2(uy, ux);
  const theta1 = angleOf((x1p - cxp) / rx, (y1p - cyp) / ry);
  let dTheta = angleOf((-x1p - cxp) / rx, (-y1p - cyp) / ry) - theta1;
  if (!sweep && dTheta > 0) dTheta -= Math.PI * 2;
  else if (sweep && dTheta < 0) dTheta += Math.PI * 2;

  // Split into <=90° pieces; a cubic approximates each to well under a pixel.
  const pieces = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 2)));
  const delta = dTheta / pieces;
  const k = (4 / 3) * Math.tan(delta / 4);
  const out: Point[][] = [];
  let th = theta1;
  let prev = p0;
  for (let i = 0; i < pieces; i++) {
    const th2 = th + delta;
    const pt = (t: number): Point => ({
      x: cx + rx * Math.cos(t) * cosP - ry * Math.sin(t) * sinP,
      y: cy + rx * Math.cos(t) * sinP + ry * Math.sin(t) * cosP,
    });
    const d1 = (t: number): Point => ({
      x: -rx * Math.sin(t) * cosP - ry * Math.cos(t) * sinP,
      y: -rx * Math.sin(t) * sinP + ry * Math.cos(t) * cosP,
    });
    const e2 = pt(th2);
    const t1 = d1(th);
    const t2 = d1(th2);
    out.push([
      prev,
      { x: prev.x + k * t1.x, y: prev.y + k * t1.y },
      { x: e2.x - k * t2.x, y: e2.y - k * t2.y },
      e2,
    ]);
    prev = e2;
    th = th2;
  }
  return out;
}

export interface FlattenOptions {
  /**
   * Target length of one flattened segment, in the path's own units. Smaller
   * means smoother curves and more points. 0.6 keeps fish curves smooth at
   * the 4 px/unit the skin texture is baked at.
   */
  tolerance?: number;
}

/**
 * Flatten a `d` string into polylines. Curves are subdivided proportionally
 * to their size, so small scale-scribbles stay cheap while the long body
 * outline stays smooth.
 */
export function flattenPath(d: string, options: FlattenOptions = {}): SubPath[] {
  const tol = options.tolerance ?? 0.6;
  const cmds = parsePath(d);
  const subPaths: SubPath[] = [];
  let cur: SubPath = [];
  let pos: Point = { x: 0, y: 0 };
  let start: Point = { x: 0, y: 0 };
  // Reflection points for the smooth variants (S/T).
  let lastCubicCtrl: Point | null = null;
  let lastQuadCtrl: Point | null = null;

  const push = (p: Point) => {
    const last = cur[cur.length - 1];
    if (!last || Math.abs(last.x - p.x) > 1e-9 || Math.abs(last.y - p.y) > 1e-9) cur.push(p);
  };
  const finish = () => {
    if (cur.length > 1) subPaths.push(cur);
    cur = [];
  };
  const addCubic = (c1: Point, c2: Point, end: Point) => {
    const steps = Math.max(2, Math.min(64, Math.ceil(controlNetLength([pos, c1, c2, end]) / tol)));
    for (let i = 1; i <= steps; i++) push(cubicAt(pos, c1, c2, end, i / steps));
    pos = end;
  };
  const addQuad = (c: Point, end: Point) => {
    const steps = Math.max(2, Math.min(48, Math.ceil(controlNetLength([pos, c, end]) / tol)));
    for (let i = 1; i <= steps; i++) push(quadAt(pos, c, end, i / steps));
    pos = end;
  };

  for (const { code, args } of cmds) {
    const rel = code === code.toLowerCase();
    const rx = rel ? pos.x : 0;
    const ry = rel ? pos.y : 0;
    const upper = code.toUpperCase();

    if (upper !== "C" && upper !== "S") lastCubicCtrl = null;
    if (upper !== "Q" && upper !== "T") lastQuadCtrl = null;

    switch (upper) {
      case "M": {
        finish();
        pos = { x: args[0] + rx, y: args[1] + ry };
        start = pos;
        push(pos);
        break;
      }
      case "L": {
        pos = { x: args[0] + rx, y: args[1] + ry };
        push(pos);
        break;
      }
      case "H": {
        pos = { x: args[0] + rx, y: pos.y };
        push(pos);
        break;
      }
      case "V": {
        pos = { x: pos.x, y: args[0] + ry };
        push(pos);
        break;
      }
      case "C": {
        const c1 = { x: args[0] + rx, y: args[1] + ry };
        const c2 = { x: args[2] + rx, y: args[3] + ry };
        const end = { x: args[4] + rx, y: args[5] + ry };
        addCubic(c1, c2, end);
        lastCubicCtrl = c2;
        break;
      }
      case "S": {
        const c1 = lastCubicCtrl
          ? { x: 2 * pos.x - lastCubicCtrl.x, y: 2 * pos.y - lastCubicCtrl.y }
          : pos;
        const c2 = { x: args[0] + rx, y: args[1] + ry };
        const end = { x: args[2] + rx, y: args[3] + ry };
        addCubic(c1, c2, end);
        lastCubicCtrl = c2;
        break;
      }
      case "Q": {
        const c = { x: args[0] + rx, y: args[1] + ry };
        const end = { x: args[2] + rx, y: args[3] + ry };
        addQuad(c, end);
        lastQuadCtrl = c;
        break;
      }
      case "T": {
        const c: Point = lastQuadCtrl
          ? { x: 2 * pos.x - lastQuadCtrl.x, y: 2 * pos.y - lastQuadCtrl.y }
          : pos;
        const end = { x: args[0] + rx, y: args[1] + ry };
        addQuad(c, end);
        lastQuadCtrl = c;
        break;
      }
      case "A": {
        const end = { x: args[5] + rx, y: args[6] + ry };
        for (const [, c1, c2, e] of arcToCubics(
          pos,
          args[0],
          args[1],
          args[2],
          args[3] !== 0,
          args[4] !== 0,
          end,
        )) {
          addCubic(c1, c2, e);
        }
        pos = end;
        break;
      }
      case "Z": {
        push(start);
        finish();
        pos = start;
        break;
      }
    }
  }
  finish();
  return subPaths;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Tight bounding box of flattened sub-paths. */
export function boundsOf(subPaths: SubPath[]): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const sp of subPaths) {
    for (const p of sp) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
