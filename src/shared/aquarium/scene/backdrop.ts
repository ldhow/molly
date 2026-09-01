// Procedural backdrop fill for the `far` and `back` layers: small rocks,
// pebbles, low weeds and driftwood silhouettes scattered across the FULL
// canvas width, so the scene reads as a planted tank rather than two clumps
// of edge decor around empty water.
//
// This complements `themes/nature-scape.ts` rather than replacing it. The
// authored theme still owns the composition that matters — the focal point,
// the concave U, the deliberate asymmetry, everything a human tuned by eye.
// This file owns only the background texture behind it.
//
// THREE RULES THIS MODULE EXISTS TO ENFORCE. Breaking any of them is a real
// regression, not a style nit:
//
//   1. `far`/`back` ONLY — `BackdropLayer` makes anything else a compile
//      error. `scripts/verify-aquarium.ts`'s composition invariants
//      (occupancy, corridor, spaciousness, focal apex, left/right asymmetry)
//      rasterize mid+front as an ALLOWLIST, so a fill confined to the back
//      provably cannot move any of them. That exemption is the whole reason
//      this can add real mass without renegotiating the authored composition.
//
//   2. SCALES ARE LITERALS drawn from a fixed variant pool, never computed.
//      `compose.ts`'s `bakeKey` excludes `worldX` but includes `scale` to
//      3dp, so N placements sharing a (species, layer, seed, scale, mirror)
//      tuple cost ONE texture in `render/decor-cache.ts`'s 12MB LRU. A
//      continuous scale (`base * envelope`) would give one bake PER
//      PLACEMENT and the cost would grow with `columns` — the LRU would
//      thrash and re-bake every frame, which presents as a permanently low
//      frame rate with no visible artifact to bisect from. So the envelope
//      picks WHICH variant; it never scales one. Density is free; variety
//      is what costs.
//
//   3. `mirror` BELONGS ONLY ON DRIFTWOOD. It's part of `bakeKey`, and every
//      species except driftwood and kelp ignores it — setting it on a pebble
//      forks a second, pixel-identical texture for nothing.
//
// Not tunable from `yarn aquarium:design`'s Scene tab: the fill is spread
// into the theme as an identifier, and that tab's Placements section only
// sees `{...}` literals inside `placements: [` (see
// `scripts/lib/placement-patch.ts`). The editor's live preview DOES render
// the fill — you just tune it by editing the pools below, then re-running
// `yarn aquarium:preview`.
//
// Dependency-free: `./types` + `@/shared/lib/rng` only, per the import
// allowlist in `src/shared/aquarium/README.md`.

import { round3, scatterBand, type ScatterBand, type ScatterVariant } from "./scatter";
import type { Placement, SceneLayer, SpeciesId } from "./types";

/** Rule 1, as a type. */
type BackdropLayer = Extract<SceneLayer, "far" | "back">;

/**
 * Fill seeds start here, above every hand-authored seed in
 * `nature-scape.ts` (the highest is 611). Two reasons: `placement-patch.ts`
 * keys placements by seed and would mis-target a collision, and
 * `verify-aquarium.ts` isolates fill pieces by this range to check that they
 * collapse onto the variant pool.
 */
export const BACKDROP_SEED_MIN = 900;

interface Variant extends ScatterVariant {
  species: SpeciesId;
  seed: number;
  /** LITERAL — copied verbatim into the placement. See rule 2. */
  scale: number;
  /** Driftwood only — see rule 3. */
  mirror?: boolean;
}

interface Band extends ScatterBand<Variant> {
  layer: BackdropLayer;
  /** px above the substrate line, PRE-`sizeFactor`. `far` only — see `Placement.yLift`'s doc for why back/mid/front must stay on the sand. */
  yLift?: readonly [number, number];
}

function scatter(band: Band): Placement[] {
  return scatterBand(band, (v, xFraction, rng) => ({
    species: v.species,
    layer: band.layer,
    xFraction,
    scale: v.scale, // COPIED, never scaled — rule 2.
    seed: v.seed,
    ...(v.mirror ? { mirror: true } : {}),
    ...(band.yLift
      ? { yLift: round3(band.yLift[0] + rng() * (band.yLift[1] - band.yLift[0])) }
      : {}),
  }));
}

/**
 * Far band: a dim, lifted bank receding behind everything, at 0.45 opacity.
 *
 * Sized against the SHORT canvas, not the tall one. `sizeFactorFor` returns
 * exactly 0.6 at 390x844 AND at 844x390 (both terms clamp), so these pieces
 * are the same absolute size in a 330px landscape water column as in a 784px
 * portrait one — anything authored against portrait becomes a wall in
 * landscape. Cap: ~60px on screen. Only `yarn aquarium:preview`'s 844x390
 * composite can catch a violation; the composition checks can't, since the
 * fill is exempt from them by rule 1.
 */
const FAR_BAND: Band = {
  key: "far",
  layer: "far",
  columns: 30,
  // Bleed past both edges so the parallax drift (+/-2.1px at `parallaxFar`)
  // never exposes a seam at the glass.
  xFrom: -0.03,
  xTo: 1.03,
  yLift: [6, 30],
  skipCentre: 0.35,
  skipEdge: 0.08,
  // Fairly even, but every variant here is SHORT — the far band's job is to
  // put something behind the open middle so it reads as depth rather than as
  // a hole, without putting anything there tall enough to close the tank.
  envelopeFloor: 0.55,
  variants: [
    { species: "pebbles", seed: 900, scale: 0.5, height: 0.0, weight: 1.2 },
    { species: "seiryuStone", seed: 902, scale: 0.4, height: 0.2, weight: 1.4 },
    { species: "seiryuStone", seed: 904, scale: 0.55, height: 0.4, weight: 1.0 },
    { species: "stemBush", seed: 906, scale: 0.45, height: 0.5, weight: 1.2 },
    { species: "stemBush", seed: 908, scale: 0.62, height: 0.75, weight: 1.0 },
    { species: "vallisneria", seed: 910, scale: 0.45, height: 0.85, weight: 0.9 },
    { species: "vallisneria", seed: 916, scale: 0.75, height: 1.0, weight: 0.9 },
    { species: "driftwood", seed: 912, scale: 0.42, height: 0.6, weight: 0.7, side: "left" },
    {
      species: "driftwood",
      seed: 914,
      scale: 0.42,
      height: 0.6,
      weight: 0.7,
      side: "right",
      mirror: true,
    },
  ],
};

/**
 * Back layer, GROUND pass: everything that dresses the substrate line —
 * pebbles, moss carpet, sand mounds, small stones, low wood.
 *
 * Split from the canopy pass below rather than sharing one pool, because the
 * two compete otherwise: `pickVariant` weights by `1 - |variant.height - u|`,
 * so a single pool holding both tall plants and pebbles resolves almost
 * entirely to one of them and the other disappears.
 *
 * `envelopeFloor` 0.45 — ground cover carries further into the middle than
 * the canopy does (bare sand across the centre reads as unfinished), but
 * still thins out rather than running edge to edge.
 *
 * No `yLift` on either back pass: `render/aquarium-canvas.tsx` turns every
 * back-layer piece >=34px tall into a `sim/crawl.ts` climb prop, and a lifted
 * prop would give a snail a stem whose base floats off the sand.
 */
const BACK_GROUND_BAND: Band = {
  key: "back-ground",
  layer: "back",
  columns: 30,
  xFrom: -0.03,
  xTo: 1.03,
  skipCentre: 0.4,
  skipEdge: 0.06,
  envelopeFloor: 0.45,
  variants: [
    { species: "pebbles", seed: 920, scale: 0.6, height: 0.0, weight: 1.4 },
    { species: "pebbles", seed: 922, scale: 0.85, height: 0.1, weight: 1.1 },
    { species: "carpet", seed: 924, scale: 0.8, height: 0.15, weight: 1.6 },
    { species: "carpet", seed: 926, scale: 1.1, height: 0.25, weight: 1.3 },
    { species: "substrateMound", seed: 928, scale: 0.55, height: 0.2, weight: 0.9 },
    { species: "substrateMound", seed: 930, scale: 0.8, height: 0.35, weight: 0.6 },
    { species: "seiryuStone", seed: 932, scale: 0.5, height: 0.45, weight: 1.2 },
    { species: "seiryuStone", seed: 934, scale: 0.72, height: 0.6, weight: 0.9 },
    { species: "stemBush", seed: 936, scale: 0.55, height: 0.6, weight: 1.3 },
    { species: "stemBush", seed: 938, scale: 0.85, height: 0.8, weight: 1.0 },
    { species: "rotala", seed: 940, scale: 0.6, height: 0.7, weight: 0.5 },
    { species: "driftwood", seed: 948, scale: 0.5, height: 0.75, weight: 0.9, side: "left" },
    {
      species: "driftwood",
      seed: 950,
      scale: 0.5,
      height: 0.75,
      weight: 0.9,
      side: "right",
      mirror: true,
    },
    { species: "driftwood", seed: 952, scale: 0.68, height: 0.95, weight: 0.5, side: "left" },
  ],
};

/**
 * Back layer, CANOPY pass: tall weed reaching well up the water column, so
 * the background has vertical mass instead of being a strip along the floor.
 *
 * "rong" is `vallisneria` and `cabomba`, NOT `kelp` — kelp is the most
 * expensive species in the tree (~1MB per bake against a 12MB budget) and at
 * these heights it reads as a flat plank rather than planting. These two
 * scale gracefully instead: `gen/plants.ts` and `gen/cabomba.ts` do NOT
 * multiply `lean`/`curve` by `scale`, so a big clump grows tall while its
 * horizontal excursion stays put — narrow silhouette, narrow bbox, cheap
 * bake. That same property is why neither may go BELOW ~0.45, where they
 * splay sideways instead of shrinking.
 *
 * `envelopeFloor` 0.10 and a 0.8 centre skip make this band FLANKS ONLY, and
 * that restriction is the single thing keeping the tank open. An earlier
 * version ran it at floor 0.75 across the full width, which closed the frame
 * into a hedge and buried the hardscape — see `backdrop-sprites.ts`'s canopy
 * note, which learned the same lesson against `assets/images/scene/scene.png`.
 * If the middle ever needs something, it wants a FAR-band silhouette.
 */
const BACK_CANOPY_BAND: Band = {
  key: "back-canopy",
  layer: "back",
  columns: 13,
  xFrom: -0.02,
  xTo: 1.02,
  skipCentre: 0.8,
  skipEdge: 0.06,
  envelopeFloor: 0.1,
  variants: [
    // Deliberately NOT vallisneria-dominated. Strap blades are the cheapest
    // way to fill a column and the fastest way to make it monotonous — a
    // canopy of nothing but straps reads as a wheat field. Roughly half the
    // pick weight goes to the two broad-leaved shapes (`stemBush`, `rotala`)
    // and the feathery one (`cabomba`) for texture and value contrast;
    // `rotala`'s warm red is the only thing keeping the band off all-green,
    // now that the palette's other warm accent (`bloom`) sits below it.
    { species: "vallisneria", seed: 944, scale: 1.1, height: 0.5, weight: 0.8 },
    { species: "vallisneria", seed: 946, scale: 1.5, height: 0.7, weight: 0.9 },
    { species: "vallisneria", seed: 954, scale: 2.0, height: 0.88, weight: 0.8 },
    // The tallest variant carries the edge framing the retired kelp used to
    // do (see nature-scape.ts) — `height: 1.0` means the envelope only picks
    // it where u peaks, i.e. at the flanks.
    { species: "vallisneria", seed: 964, scale: 2.7, height: 1.0, weight: 1.0 },
    { species: "cabomba", seed: 956, scale: 1.2, height: 0.6, weight: 1.0 },
    { species: "cabomba", seed: 958, scale: 1.7, height: 0.85, weight: 1.1 },
    { species: "stemBush", seed: 960, scale: 1.8, height: 0.7, weight: 1.4 },
    { species: "stemBush", seed: 966, scale: 2.4, height: 0.95, weight: 1.1 },
    { species: "rotala", seed: 962, scale: 1.5, height: 0.6, weight: 0.9 },
  ],
};

const BANDS = [FAR_BAND, BACK_GROUND_BAND, BACK_CANOPY_BAND];

/** Upper bound on the fill's distinct bake count — `verify-aquarium.ts` asserts against it, which is what keeps rule 2 from silently rotting. */
export const BACKDROP_VARIANTS = BANDS.reduce((n, b) => n + b.variants.length, 0);

/** Built once at import: deterministic, so `composeScene` (which re-runs on every resize) pays nothing for it. */
export const BACKDROP_FILL: readonly Placement[] = BANDS.flatMap(scatter);
