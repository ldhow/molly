// The seeded scatter both backdrop fills are built on — `backdrop.ts`
// (procedural species) and `backdrop-sprites.ts` (painted PNG pieces). Only
// the emitted placement type differs between them; the placement MATHS is
// identical, and it is the part that isn't obvious, so it lives here once.
//
// The model: jittered-stratified columns across a normalized x range, with a
// cosine "U" envelope that modulates both how often a cell is filled and
// WHICH variant gets picked there. Stratification is what stops a plain
// random scatter from clumping in some places and leaving bald patches in
// others — one candidate per cell, jittered inside it, reads as natural
// spacing rather than as either a grid or a mess.
//
// Dependency-free: `@/shared/lib/rng` only.

import { makeRng } from "@/shared/lib/rng";

export interface ScatterVariant {
  /** 0 = hugs the substrate, 1 = tall silhouette. Matched against the envelope, so tall variants win at the flanks and low ones through the middle. */
  height: number;
  /** Relative pick frequency, before the envelope match. */
  weight: number;
  /** Restrict to one half of the canvas — for pieces whose art has a direction (a mirrored driftwood should only appear where its sweep points inward). */
  side?: "left" | "right";
}

export interface ScatterBand<V extends ScatterVariant> {
  /** Distinct rng stream per band — two bands over the same range would otherwise scatter identically. */
  key: string;
  /** Stratified cells across [xFrom, xTo]: one candidate each, plus an envelope-weighted chance of a second. */
  columns: number;
  /** Normally bled slightly past 0 and 1 so the parallax drift never exposes a seam at the glass. */
  xFrom: number;
  xTo: number;
  /** Probability a cell stays empty, at the envelope's floor / at its peak. */
  skipCentre: number;
  skipEdge: number;
  /**
   * The envelope's value across the middle third — the band's density
   * profile, and the single most important number in a backdrop fill.
   *
   * Low (~0.1) is the concave-U every aquascape reference uses: mass on the
   * flanks, open water down the middle. High (~0.9) is even full-width
   * coverage. Bands want DIFFERENT values — a scatter of pebbles reads
   * correctly spread evenly across the sand, while the same treatment
   * applied to tall planting closes the tank into a hedge.
   */
  envelopeFloor: number;
  variants: readonly V[];
}

/** Half-width of the middle the envelope treats as "centre". */
const CENTRE_HALF = 1 / 3;
/** Never let a variant's pick weight collapse to zero — the occasional "wrong" piece is what stops the height ramp reading as machine-generated. */
const AFFINITY_FLOOR = 0.08;
const EXTRA_DRAW_AT_EDGE = 0.55;
const JITTER_LO = 0.12;
const JITTER_HI = 0.88;

/**
 * 1 at both edges, `floor` across the middle third, cosine-ramped between.
 *
 * `floor` is the density dial. Low (~0.2) gives the classic concave-U
 * aquascape: mass on the flanks, open water down the middle. High (~0.75)
 * gives near-even full-frame coverage, and the remaining falloff serves only
 * to keep the TALLER variants at the flanks so the scene still has a
 * silhouette instead of one uniform hedge.
 */
export function uEnvelope(t: number, floor: number): number {
  const d = Math.min(1, Math.abs(t - 0.5) * 2);
  const ramp = Math.max(0, (d - CENTRE_HALF) / (1 - CENTRE_HALF));
  return floor + (1 - floor) * ((1 - Math.cos(ramp * Math.PI)) / 2);
}

function pickVariant<V extends ScatterVariant>(
  pool: readonly V[],
  u: number,
  rng: () => number,
): V {
  const weights: number[] = [];
  let total = 0;
  for (const v of pool) {
    const w = v.weight * Math.max(AFFINITY_FLOOR, 1 - Math.abs(v.height - u));
    weights.push(w);
    total += w;
  }
  let r = rng() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

export const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Walks the band's cells and emits placements for each filled draw. `emit`
 * receives the chosen variant, the jittered `xFraction`, and the band's rng —
 * threaded through rather than re-seeded so a caller can draw extra
 * per-placement values (a vertical lift, a rotation) without forking the
 * stream and desynchronising every later cell.
 *
 * `emit` may return an ARRAY to place several pieces for one draw — that's
 * how `backdrop-sprites.ts` builds a mossy rock out of the separate rock and
 * moss PNGs it actually has.
 */
export function scatterBand<V extends ScatterVariant, P>(
  band: ScatterBand<V>,
  emit: (variant: V, xFraction: number, rng: () => number) => P | readonly P[],
): P[] {
  const rng = makeRng(`backdrop-${band.key}`);
  const cell = (band.xTo - band.xFrom) / band.columns;
  const out: P[] = [];

  for (let i = 0; i < band.columns; i++) {
    const u = uEnvelope((i + 0.5) / band.columns, band.envelopeFloor);
    const skip = band.skipCentre + (band.skipEdge - band.skipCentre) * u;
    const draws = 1 + (rng() < u * EXTRA_DRAW_AT_EDGE ? 1 : 0);

    for (let d = 0; d < draws; d++) {
      if (rng() < skip) continue;
      const xFraction = round3(
        band.xFrom + (i + JITTER_LO + rng() * (JITTER_HI - JITTER_LO)) * cell,
      );
      const side = xFraction < 0.5 ? "left" : "right";
      const pool = band.variants.filter((v) => !v.side || v.side === side);
      const emitted = emit(pickVariant(pool, u, rng), xFraction, rng);
      if (Array.isArray(emitted)) out.push(...(emitted as readonly P[]));
      else out.push(emitted as P);
    }
  }
  return out;
}
