// FOURTH backend over the fish IR: a software rasterizer that renders
// `Primitive[]` into a plain RGBA byte buffer.
//
// The other three (declarative Skia in fish-sprite.tsx, imperative Skia in
// fish-picture.ts, SVG in scripts/lib/fish-svg.ts) all target a real drawing
// API. This one exists because the 3D fish needs the *same* artwork as a
// texture, and React Native has no DOM canvas — `DataTexture` over raw bytes
// is the only procedural-texture route available.
//
// Deliberately dependency-free (no three/Skia/React) so it runs identically
// in the app, in the browser preview, and in Node verification scripts.
//
// Compositing happens in sRGB byte space, which is what Skia does for these
// fish and what the art was tuned against. The consumer is responsible for
// tagging the resulting texture as sRGB.

import { flattenPath, type Point, type SubPath } from "../lib/path2d";

import type { Blend, Paint, Primitive } from "./render-spec";

export interface RasterTarget {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row-major from the top. */
  data: Uint8ClampedArray;
}

export interface RasterOptions {
  /** Local-space rect the buffer covers. */
  box: { x: number; y: number; width: number; height: number };
  /** Output pixels per local unit (before supersampling). */
  pxPerUnit: number;
  /**
   * Render at this multiple and box-downsample once at the end. 2 gives clean
   * edges far more simply and robustly than per-pixel coverage maths.
   */
  supersample?: number;
}

// ---------------------------------------------------------------------------
// Colour parsing. The IR uses both `#rrggbb` and `rgba(r,g,b,a)`.
// ---------------------------------------------------------------------------

type RGBA = [r: number, g: number, b: number, a: number];

const colorCache = new Map<string, RGBA>();

export function parseColor(css: string): RGBA {
  const hit = colorCache.get(css);
  if (hit) return hit;
  let out: RGBA = [0, 0, 0, 1];
  const s = css.trim();
  const hex = /^#([0-9a-f]{3,8})$/i.exec(s);
  if (hex) {
    const h = hex[1];
    if (h.length === 3) {
      out = [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16), 1];
    } else {
      const n = parseInt(h.slice(0, 6), 16);
      const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
      out = [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
    }
  } else {
    const m = /^rgba?\(([^)]+)\)$/i.exec(s);
    if (m) {
      const parts = m[1].split(",").map((p) => parseFloat(p));
      out = [parts[0] | 0, parts[1] | 0, parts[2] | 0, parts.length > 3 ? parts[3] : 1];
    }
  }
  colorCache.set(css, out);
  return out;
}

// ---------------------------------------------------------------------------
// Coverage rasterisation. One shape at a time into a scalar alpha buffer,
// then composited — which is what makes clip/blur/blend straightforward.
// ---------------------------------------------------------------------------

/**
 * A scalar alpha buffer for one shape at a time, tracking the rectangle it
 * actually touched.
 *
 * That dirty rect is not an optimisation detail — it is the difference between
 * this rasterizer being usable and not. Every per-primitive operation (clear,
 * blur, composite) is bounded by it, so drawing one 8px speckle costs ~8px of
 * work instead of a full pass over the ~400k-pixel buffer. Gold Dust has 23
 * blurred speckles; unbounded, that alone took ~390ms per fish.
 */
const BLUR_PASSES = 3;
/** Above this many pixels, a blur switches to the half-resolution path. */
const HALF_RES_BLUR_AREA = 40_000;

/**
 * Separable 3-pass box blur (≈ a Gaussian) over a rect of a strided buffer.
 *
 * Bounds are tested inline rather than through an accessor: at ~3M samples for
 * a full-body blur the call overhead alone dominated the entire rasterize.
 * Samples outside the rect read as 0, which is the transparent border a mask
 * blur wants — safe because `Coverage.reset()` clears the previous shape's
 * dirty rect, so nothing stale is ever out there.
 */
function boxBlurRect(
  a: Float32Array,
  W: number,
  x0: number,
  y0: number,
  bw: number,
  bh: number,
  r: number,
  tmp: Float32Array,
) {
  const x1 = x0 + bw - 1;
  const y1 = y0 + bh - 1;
  const norm = 1 / (2 * r + 1);
  for (let p = 0; p < BLUR_PASSES; p++) {
    for (let y = y0; y <= y1; y++) {
      const arow = y * W;
      const trow = (y - y0) * bw;
      let sum = 0;
      const initHi = Math.min(x1, x0 + r);
      for (let k = x0; k <= initHi; k++) sum += a[arow + k];
      for (let x = x0; x <= x1; x++) {
        tmp[trow + (x - x0)] = sum * norm;
        const addX = x + r + 1;
        const subX = x - r;
        if (addX <= x1) sum += a[arow + addX];
        if (subX >= x0) sum -= a[arow + subX];
      }
    }
    for (let y = y0; y <= y1; y++) {
      const trow = (y - y0) * bw;
      const arow = y * W + x0;
      for (let x = 0; x < bw; x++) a[arow + x] = tmp[trow + x];
    }
    for (let x = x0; x <= x1; x++) {
      let sum = 0;
      const initHi = Math.min(y1, y0 + r);
      for (let k = y0; k <= initHi; k++) sum += a[k * W + x];
      for (let y = y0; y <= y1; y++) {
        tmp[(y - y0) * bw + (x - x0)] = sum * norm;
        const addY = y + r + 1;
        const subY = y - r;
        if (addY <= y1) sum += a[addY * W + x];
        if (subY >= y0) sum -= a[subY * W + x];
      }
    }
    for (let y = y0; y <= y1; y++) {
      const trow = (y - y0) * bw;
      const arow = y * W + x0;
      for (let x = 0; x < bw; x++) a[arow + x] = tmp[trow + x];
    }
  }
}

// Rasterizing allocates several megabytes of scratch per fish (a float RGBA
// accumulator plus coverage buffers). Bakes are strictly sequential and
// single-threaded, so the two largest buffers are pooled and reused instead —
// without this the GC churn alone produced ~200ms outliers, which matters
// because each bake happens inside a frame.
let poolRgba = new Float32Array(0);
let poolCoverage = new Float32Array(0);

class Coverage {
  readonly w: number;
  readonly h: number;
  readonly a: Float32Array;
  minY = Infinity;
  maxY = -Infinity;
  minX = Infinity;
  maxX = -Infinity;
  /** Scratch for blur, grown on demand and reused across primitives. */
  private scratch: Float32Array = new Float32Array(0);
  /** Half-resolution scratch for the large-blur path. */
  private half: Float32Array = new Float32Array(0);

  /**
   * @param pooled reuse the shared coverage buffer. Only safe for the main
   *   drawing buffer — clip masks must outlive it, so they allocate their own.
   */
  constructor(w: number, h: number, pooled = false) {
    this.w = w;
    this.h = h;
    if (pooled) {
      if (poolCoverage.length < w * h) poolCoverage = new Float32Array(w * h);
      this.a = poolCoverage;
      this.a.fill(0, 0, w * h);
    } else {
      this.a = new Float32Array(w * h);
    }
  }

  get isEmpty() {
    return this.maxY < this.minY || this.maxX < this.minX;
  }

  /** Clear only what the previous shape dirtied. */
  reset() {
    if (!this.isEmpty) {
      const y0 = Math.max(0, Math.floor(this.minY));
      const y1 = Math.min(this.h - 1, Math.ceil(this.maxY));
      const x0 = Math.max(0, Math.floor(this.minX));
      const x1 = Math.min(this.w - 1, Math.ceil(this.maxX));
      for (let y = y0; y <= y1; y++) this.a.fill(0, y * this.w + x0, y * this.w + x1 + 1);
    }
    this.minY = Infinity;
    this.maxY = -Infinity;
    this.minX = Infinity;
    this.maxX = -Infinity;
  }

  private track(y: number) {
    if (y < this.minY) this.minY = y;
    if (y > this.maxY) this.maxY = y;
  }

  private trackX(x0: number, x1: number) {
    if (x0 < this.minX) this.minX = x0;
    if (x1 > this.maxX) this.maxX = x1;
  }

  /** Scanline fill with nonzero winding — matches Skia's FillType.Winding. */
  fillPolygons(subPaths: SubPath[]) {
    interface Edge {
      x0: number;
      y0: number;
      x1: number;
      y1: number;
      dir: number;
    }
    const edges: Edge[] = [];
    let lo = Infinity;
    let hi = -Infinity;
    for (const sp of subPaths) {
      for (let i = 0; i < sp.length; i++) {
        const p0 = sp[i];
        const p1 = sp[(i + 1) % sp.length];
        if (p0.y === p1.y) continue;
        edges.push(
          p0.y < p1.y
            ? { x0: p0.x, y0: p0.y, x1: p1.x, y1: p1.y, dir: 1 }
            : { x0: p1.x, y0: p1.y, x1: p0.x, y1: p0.y, dir: -1 },
        );
        lo = Math.min(lo, p0.y, p1.y);
        hi = Math.max(hi, p0.y, p1.y);
      }
    }
    if (!edges.length) return;

    const yStart = Math.max(0, Math.floor(lo));
    const yEnd = Math.min(this.h - 1, Math.ceil(hi));
    const xs: { x: number; dir: number }[] = [];
    for (let y = yStart; y <= yEnd; y++) {
      const sy = y + 0.5;
      xs.length = 0;
      for (const e of edges) {
        if (sy < e.y0 || sy >= e.y1) continue;
        xs.push({ x: e.x0 + ((sy - e.y0) / (e.y1 - e.y0)) * (e.x1 - e.x0), dir: e.dir });
      }
      if (xs.length < 2) continue;
      xs.sort((p, q) => p.x - q.x);
      let winding = 0;
      const row = y * this.w;
      for (let i = 0; i < xs.length - 1; i++) {
        winding += xs[i].dir;
        if (winding === 0) continue;
        const xa = Math.max(0, Math.ceil(xs[i].x - 0.5));
        const xb = Math.min(this.w - 1, Math.floor(xs[i + 1].x - 0.5));
        for (let x = xa; x <= xb; x++) this.a[row + x] = 1;
        if (xb >= xa) {
          this.track(y);
          this.trackX(xa, xb);
        }
      }
    }
  }

  /**
   * Stroke by stamping a disc along the flattened centreline. Skia strokes
   * this IR with round caps AND round joins (see fish-picture.ts), so a disc
   * sweep is not an approximation here — it is exactly that shape.
   */
  strokePolylines(subPaths: SubPath[], radius: number) {
    const r = Math.max(0.5, radius);
    const step = Math.max(0.35, r * 0.5);
    const stamp = (p: Point) => {
      const x0 = Math.max(0, Math.floor(p.x - r));
      const x1 = Math.min(this.w - 1, Math.ceil(p.x + r));
      const y0 = Math.max(0, Math.floor(p.y - r));
      const y1 = Math.min(this.h - 1, Math.ceil(p.y + r));
      for (let y = y0; y <= y1; y++) {
        const dy = y + 0.5 - p.y;
        const row = y * this.w;
        for (let x = x0; x <= x1; x++) {
          const dx = x + 0.5 - p.x;
          if (dx * dx + dy * dy <= r * r) this.a[row + x] = 1;
        }
      }
      if (y1 >= y0) {
        this.track(y0);
        this.track(y1);
        this.trackX(x0, x1);
      }
    };
    for (const sp of subPaths) {
      if (sp.length === 1) {
        stamp(sp[0]);
        continue;
      }
      for (let i = 0; i < sp.length - 1; i++) {
        const p0 = sp[i];
        const p1 = sp[i + 1];
        const len = Math.hypot(p1.x - p0.x, p1.y - p0.y);
        const n = Math.max(1, Math.ceil(len / step));
        for (let k = 0; k <= n; k++) {
          stamp({ x: p0.x + ((p1.x - p0.x) * k) / n, y: p0.y + ((p1.y - p0.y) * k) / n });
        }
      }
    }
  }

  fillCircle(cx: number, cy: number, r: number) {
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - cy;
      const row = y * this.w;
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        if (dx * dx + dy * dy <= r * r) this.a[row + x] = 1;
      }
    }
    if (y1 >= y0) {
      this.track(y0);
      this.track(y1);
      this.trackX(x0, x1);
    }
  }

  /**
   * Three box passes ≈ a Gaussian. Mirrors Skia's normal-style mask blur.
   *
   * Runs only over the dirty rect grown by the blur's reach. Doing this over
   * the whole buffer is what made speckled varieties (23 blurred dots each)
   * cost hundreds of milliseconds per fish.
   */
  blur(radiusPx: number) {
    const r = Math.round(radiusPx);
    if (r < 1 || this.isEmpty) return;
    const reach = r * BLUR_PASSES + 1;

    const x0 = Math.max(0, Math.floor(this.minX) - reach);
    const x1 = Math.min(this.w - 1, Math.ceil(this.maxX) + reach);
    const y0 = Math.max(0, Math.floor(this.minY) - reach);
    const y1 = Math.min(this.h - 1, Math.ceil(this.maxY) + reach);
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    if (bw <= 0 || bh <= 0) return;

    if (bw * bh > HALF_RES_BLUR_AREA && r >= 4) {
      this.blurHalfRes(x0, y0, bw, bh, r);
    } else {
      if (this.scratch.length < bw * bh) this.scratch = new Float32Array(bw * bh);
      boxBlurRect(this.a, this.w, x0, y0, bw, bh, r, this.scratch);
    }

    this.minY = y0;
    this.maxY = y1;
    this.minX = x0;
    this.maxX = x1;
  }

  /**
   * Blur a large region on a half-resolution copy.
   *
   * A blur is a low-pass filter, so the result genuinely has no detail worth
   * keeping at full resolution — downsampling first is a quarter of the work
   * for a visually identical result. On the full-body sheen that dominates
   * the speckled varieties this is the difference between ~35ms and ~9ms.
   */
  private blurHalfRes(x0: number, y0: number, bw: number, bh: number, r: number) {
    const hw = Math.ceil(bw / 2);
    const hh = Math.ceil(bh / 2);
    if (this.half.length < hw * hh) this.half = new Float32Array(hw * hh);
    if (this.scratch.length < hw * hh) this.scratch = new Float32Array(hw * hh);
    const half = this.half;
    const a = this.a;
    const W = this.w;

    // Downsample with a 2x2 box.
    for (let y = 0; y < hh; y++) {
      const sy0 = y0 + y * 2;
      const sy1 = Math.min(y0 + bh - 1, sy0 + 1);
      for (let x = 0; x < hw; x++) {
        const sx0 = x0 + x * 2;
        const sx1 = Math.min(x0 + bw - 1, sx0 + 1);
        half[y * hw + x] =
          (a[sy0 * W + sx0] + a[sy0 * W + sx1] + a[sy1 * W + sx0] + a[sy1 * W + sx1]) * 0.25;
      }
    }

    boxBlurRect(half, hw, 0, 0, hw, hh, Math.max(1, Math.round(r / 2)), this.scratch);

    // Bilinear upsample back over the rect.
    for (let y = 0; y < bh; y++) {
      const fy = Math.min(hh - 1.0001, Math.max(0, (y - 0.5) * 0.5));
      const iy = Math.floor(fy);
      const ty = fy - iy;
      const iy1 = Math.min(hh - 1, iy + 1);
      const arow = (y0 + y) * W + x0;
      for (let x = 0; x < bw; x++) {
        const fx = Math.min(hw - 1.0001, Math.max(0, (x - 0.5) * 0.5));
        const ix = Math.floor(fx);
        const tx = fx - ix;
        const ix1 = Math.min(hw - 1, ix + 1);
        const top = half[iy * hw + ix] + (half[iy * hw + ix1] - half[iy * hw + ix]) * tx;
        const bot = half[iy1 * hw + ix] + (half[iy1 * hw + ix1] - half[iy1 * hw + ix]) * tx;
        a[arow + x] = top + (bot - top) * ty;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Paint evaluation — solid, linear and radial, in device pixels.
// ---------------------------------------------------------------------------

interface Transform {
  /** local -> pixel */
  sx: number;
  sy: number;
  tx: number;
  ty: number;
}

const toPx = (t: Transform, p: { x: number; y: number }) => ({
  x: p.x * t.sx + t.tx,
  y: p.y * t.sy + t.ty,
});

interface Shader {
  at(x: number, y: number, out: RGBA): void;
}

function makeShader(paint: Paint, t: Transform): Shader {
  if (paint.type === "solid") {
    const c = parseColor(paint.color);
    return {
      at(_x, _y, out) {
        out[0] = c[0];
        out[1] = c[1];
        out[2] = c[2];
        out[3] = c[3];
      },
    };
  }

  const stops = paint.stops.map((s) => ({ offset: s.offset, color: parseColor(s.color) }));
  const sample = (u: number, out: RGBA) => {
    const tt = u <= 0 ? 0 : u >= 1 ? 1 : u;
    let i = 0;
    while (i < stops.length - 1 && tt > stops[i + 1].offset) i++;
    const a = stops[Math.min(i, stops.length - 1)];
    const b = stops[Math.min(i + 1, stops.length - 1)];
    const span = b.offset - a.offset;
    const k = span <= 0 ? 0 : (tt - a.offset) / span;
    out[0] = a.color[0] + (b.color[0] - a.color[0]) * k;
    out[1] = a.color[1] + (b.color[1] - a.color[1]) * k;
    out[2] = a.color[2] + (b.color[2] - a.color[2]) * k;
    out[3] = a.color[3] + (b.color[3] - a.color[3]) * k;
  };

  if (paint.type === "linear") {
    const p0 = toPx(t, paint.from);
    const p1 = toPx(t, paint.to);
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const denom = dx * dx + dy * dy || 1;
    return {
      at(x, y, out) {
        sample(((x - p0.x) * dx + (y - p0.y) * dy) / denom, out);
      },
    };
  }

  // radial, with the optional elliptical `scale` about the centre — the same
  // construction Skia gets via a local matrix and SVG via gradientTransform.
  const c = toPx(t, paint.center);
  const rPx = paint.radius * t.sx;
  const sxx = paint.scale?.x ?? 1;
  const syy = paint.scale?.y ?? 1;
  return {
    at(x, y, out) {
      const dx = (x - c.x) / (sxx || 1);
      const dy = (y - c.y) / (syy || 1);
      sample(Math.hypot(dx, dy) / (rPx || 1), out);
    },
  };
}

// ---------------------------------------------------------------------------
// Blending. Only the modes the fish IR actually uses.
// ---------------------------------------------------------------------------

function blendChannel(mode: Blend, dst: number, src: number): number {
  const d = dst / 255;
  const s = src / 255;
  switch (mode) {
    case "multiply":
      return d * s * 255;
    case "screen":
      return (d + s - d * s) * 255;
    case "overlay":
      return (d <= 0.5 ? 2 * d * s : 1 - 2 * (1 - d) * (1 - s)) * 255;
    case "softLight": {
      const g = d <= 0.25 ? ((16 * d - 12) * d + 4) * d : Math.sqrt(d);
      return (s <= 0.5 ? d - (1 - 2 * s) * d * (1 - d) : d + (2 * s - 1) * (g - d)) * 255;
    }
    case "plusLighter":
      return Math.min(255, dst + src);
    default:
      return src;
  }
}

// ---------------------------------------------------------------------------
// The renderer.
// ---------------------------------------------------------------------------

class Rasterizer {
  readonly w: number;
  readonly h: number;
  readonly rgba: Float32Array; // straight (non-premultiplied) 0..255 + alpha 0..1
  private readonly t: Transform;
  private readonly cov: Coverage;
  private readonly clipCache = new Map<string, Float32Array>();
  private readonly pathCache = new Map<string, SubPath[]>();
  private readonly tmp: RGBA = [0, 0, 0, 1];

  constructor(w: number, h: number, t: Transform) {
    this.w = w;
    this.h = h;
    this.t = t;
    const need = w * h * 4;
    if (poolRgba.length < need) poolRgba = new Float32Array(need);
    this.rgba = poolRgba;
    this.rgba.fill(0, 0, need);
    this.cov = new Coverage(w, h, true);
  }

  private flat(d: string): SubPath[] {
    let hit = this.pathCache.get(d);
    if (!hit) {
      // Flatten in local units, then map to pixels, so the tolerance is
      // expressed in art units and stays stable across texture resolutions.
      hit = flattenPath(d, { tolerance: 0.35 }).map((sp) => sp.map((p) => toPx(this.t, p)));
      this.pathCache.set(d, hit);
    }
    return hit;
  }

  /** Coverage mask for a clip path `d`, cached — every pattern clips to the body. */
  private clipMask(d: string): Float32Array {
    let hit = this.clipCache.get(d);
    if (!hit) {
      const c = new Coverage(this.w, this.h);
      c.fillPolygons(this.flat(d));
      hit = c.a;
      this.clipCache.set(d, hit);
    }
    return hit;
  }

  /** Composite the current coverage buffer through a paint. */
  private composite(
    shader: Shader,
    opacity: number,
    blend: Blend | undefined,
    clip: Float32Array | null,
    groupAlpha: number,
  ) {
    const { cov } = this;
    if (cov.isEmpty) return;
    const y0 = Math.max(0, Math.floor(cov.minY));
    const y1 = Math.min(this.h - 1, Math.ceil(cov.maxY));
    // Bounded in X as well as Y: scanning the full width for a speckle a few
    // pixels across was a large share of the per-primitive cost.
    const cx0 = Math.max(0, Math.floor(cov.minX));
    const cx1 = Math.min(this.w - 1, Math.ceil(cov.maxX));
    const out = this.tmp;
    for (let y = y0; y <= y1; y++) {
      const row = y * this.w;
      for (let x = cx0; x <= cx1; x++) {
        let a = cov.a[row + x];
        if (a <= 0.0001) continue;
        if (clip) {
          a *= clip[row + x];
          if (a <= 0.0001) continue;
        }
        shader.at(x + 0.5, y + 0.5, out);
        const srcA = a * out[3] * opacity * groupAlpha;
        if (srcA <= 0.0001) continue;

        const i = (row + x) * 4;
        const dstA = this.rgba[i + 3];
        for (let ch = 0; ch < 3; ch++) {
          const blended =
            blend && blend !== "srcOver"
              ? blendChannel(blend, this.rgba[i + ch], out[ch])
              : out[ch];
          // `blended` is what the source contributes where it overlaps the
          // destination; standard source-over on straight colour.
          this.rgba[i + ch] = this.rgba[i + ch] * (1 - srcA) + blended * srcA;
        }
        this.rgba[i + 3] = dstA + srcA * (1 - dstA);
      }
    }
  }

  draw(prims: Primitive[], groupAlpha = 1) {
    for (const prim of prims) {
      if (prim.kind === "group") {
        // Isolation/backdrop semantics are not reproduced: the albedo subset
        // this renderer is fed is flat, so a group here is just nesting.
        this.draw(prim.children, groupAlpha * (prim.opacity ?? 1));
        continue;
      }

      const clip = prim.clip ? this.clipMask(prim.clip) : null;
      this.cov.reset();

      if (prim.kind === "circle") {
        const c = toPx(this.t, { x: prim.cx, y: prim.cy });
        this.cov.fillCircle(c.x, c.y, prim.r * this.t.sx);
      } else if (prim.kind === "path") {
        const polys = this.flat(prim.d);
        if (prim.stroke) this.cov.strokePolylines(polys, (prim.stroke.width * this.t.sx) / 2);
        else this.cov.fillPolygons(polys);
      } else {
        continue;
      }

      if (prim.blur && prim.blur > 0) this.cov.blur(prim.blur * this.t.sx);

      this.composite(
        makeShader(prim.paint, this.t),
        prim.paint.opacity ?? 1,
        prim.blend,
        clip,
        groupAlpha,
      );
    }
  }
}

/**
 * Render IR primitives into an RGBA buffer covering `box` in local units.
 * Supersampled and box-downsampled for anti-aliasing.
 */
export function rasterizeSpec(prims: Primitive[], options: RasterOptions): RasterTarget {
  const ss = options.supersample ?? 2;
  const scale = options.pxPerUnit * ss;
  const w = Math.max(1, Math.round(options.box.width * scale));
  const h = Math.max(1, Math.round(options.box.height * scale));

  const r = new Rasterizer(w, h, {
    sx: scale,
    sy: scale,
    tx: -options.box.x * scale,
    ty: -options.box.y * scale,
  });
  r.draw(prims);

  const outW = Math.max(1, Math.round(w / ss));
  const outH = Math.max(1, Math.round(h / ss));
  const data = new Uint8ClampedArray(outW * outH * 4);
  const inv = 1 / (ss * ss);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      let cr = 0;
      let cg = 0;
      let cb = 0;
      let ca = 0;
      for (let dy = 0; dy < ss; dy++) {
        const sy = Math.min(h - 1, y * ss + dy);
        for (let dx = 0; dx < ss; dx++) {
          const sx = Math.min(w - 1, x * ss + dx);
          const i = (sy * w + sx) * 4;
          const a = r.rgba[i + 3];
          // Weight colour by alpha so transparent pixels don't drag edges
          // toward black when averaged.
          cr += r.rgba[i] * a;
          cg += r.rgba[i + 1] * a;
          cb += r.rgba[i + 2] * a;
          ca += a;
        }
      }
      const o = (y * outW + x) * 4;
      if (ca > 0.0001) {
        data[o] = cr / ca;
        data[o + 1] = cg / ca;
        data[o + 2] = cb / ca;
      }
      data[o + 3] = ca * inv * 255;
    }
  }
  return { width: outW, height: outH, data };
}
