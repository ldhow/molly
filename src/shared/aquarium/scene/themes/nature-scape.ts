// The authored planted-aquarium composition — tuned by eye against real
// aquascaping composition rules, not generated:
//
// - Concave "U" layout: mass on both edges, height descending into an open
//   centre — never a flat wall of decor across the tank.
// - Focal point (the driftwood centerpiece) sits on a rule-of-thirds line,
//   not dead centre — its base is left-of-centre but its canopy leans right
//   (see driftwood.ts's `trunkHeading`) so the apex itself lands near 1/3.
// - Deliberate asymmetry: the left cluster carries clearly more visual
//   weight than the right one (a second, smaller, MIRRORED driftwood piece —
//   `mirror: true` fixes the old `trunkHeading` bug that made every piece
//   lean the same way regardless of which side of the tank it sat on).
// - Distinct fore/mid/background zones: `substrateMound` raises the sand at
//   the back and sides instead of a flat band; `pebbles` breaks up the
//   front substrate/glass seam.
//
// `xFraction` is normalized canvas width; `scale` differences between back
// and mid/front pieces are a cheap depth cue (smaller = farther), on top of
// draw order. `verify-aquarium.ts`'s column-occupancy check encodes the
// "clear centre" and asymmetry rules above so they can't drift back to a
// centred, symmetric layout without a failing check.

import type { SceneTheme } from "../types";

export const NATURE_SCAPE: SceneTheme = {
  name: "nature-scape",
  swimLanes: [{ xFraction: [0.32, 0.72] }],
  placements: [
    // Back layer: the substrate itself rises at the sides (real scapes
    // slope up toward the back/edges), framed by tall grass descending in
    // height toward the open centre.
    //
    // Kelp goes FIRST (before the grass) so it sits furthest back — it's a
    // dark silhouette wall framing both edges and reaching much higher into
    // frame than the vallisneria in front of it, which is what gives the
    // scene a top-to-bottom sense of depth rather than a band of planting
    // along the floor. The right-hand clump is `mirror: true` so it leans
    // inward toward the centre instead of off-canvas (the same directional
    // fix `driftwood` needed — see this theme's header).
    { species: "kelp", layer: "back", xFraction: 0.015, scale: 1.25, seed: 301 },
    { species: "kelp", layer: "back", xFraction: 0.075, scale: 1.0, seed: 303 },
    { species: "kelp", layer: "back", xFraction: 0.965, scale: 1.15, seed: 305, mirror: true },
    { species: "substrateMound", layer: "back", xFraction: 0.14, scale: 1.5, seed: 101 },
    { species: "substrateMound", layer: "back", xFraction: 0.88, scale: 1.1, seed: 103 },
    { species: "vallisneria", layer: "back", xFraction: 0.03, scale: 1.3, seed: 11 },
    { species: "vallisneria", layer: "back", xFraction: 0.09, scale: 1.15, seed: 23 },
    { species: "vallisneria", layer: "back", xFraction: 0.16, scale: 0.95, seed: 25 },
    { species: "vallisneria", layer: "back", xFraction: 0.24, scale: 0.72, seed: 27 },
    { species: "vallisneria", layer: "back", xFraction: 0.94, scale: 1.05, seed: 41 },
    { species: "vallisneria", layer: "back", xFraction: 0.99, scale: 0.88, seed: 59 },
    { species: "stemBush", layer: "back", xFraction: 0.83, scale: 0.85, seed: 73 },

    // Mid layer: the driftwood centerpiece (left, dominant) with anubias
    // mounted on its branches, plus a smaller mirrored echo on the right so
    // the two sides read as related but asymmetric, not a mirrored pair.
    { species: "driftwood", layer: "mid", xFraction: 0.17, scale: 1.35, seed: 3, id: "wood1" },
    {
      species: "anubias",
      layer: "mid",
      xFraction: 0.17,
      scale: 1.05,
      seed: 5,
      attachToId: "wood1",
      anchorIndex: 0,
    },
    {
      species: "anubias",
      layer: "mid",
      xFraction: 0.17,
      scale: 0.8,
      seed: 7,
      attachToId: "wood1",
      anchorIndex: 1,
    },
    {
      species: "anubias",
      layer: "mid",
      xFraction: 0.17,
      scale: 0.92,
      seed: 9,
      attachToId: "wood1",
      anchorIndex: 2,
    },
    // Oyaishi (the dominant stone in a Japanese-style layout) beside the
    // wood; a smaller fukuishi companion stone lower and further back.
    { species: "seiryuStone", layer: "mid", xFraction: 0.24, scale: 1.25, seed: 13 },
    { species: "seiryuStone", layer: "mid", xFraction: 0.1, scale: 0.72, seed: 15 },
    {
      species: "driftwood",
      layer: "mid",
      xFraction: 0.9,
      scale: 0.85,
      seed: 33,
      id: "wood2",
      mirror: true,
    },
    {
      species: "anubias",
      layer: "mid",
      xFraction: 0.9,
      scale: 0.9,
      seed: 35,
      attachToId: "wood2",
      anchorIndex: 0,
    },
    { species: "seiryuStone", layer: "mid", xFraction: 0.79, scale: 0.9, seed: 19 },

    // Front layer: low filler kept sparse so it never blocks the tank —
    // one stone cropped by the edge, pebbles breaking up the substrate seam
    // in-lane, where they read as texture rather than an obstacle.
    { species: "seiryuStone", layer: "front", xFraction: 0.02, scale: 1.1, seed: 31 },
    { species: "stemBush", layer: "front", xFraction: 0.76, scale: 0.7, seed: 29 },
    { species: "pebbles", layer: "front", xFraction: 0.46, scale: 0.55, seed: 201 },
    { species: "pebbles", layer: "front", xFraction: 0.66, scale: 0.4, seed: 203 },
    // Warm colour accents in the bottom corners — small on purpose (see
    // `gen/bloom.ts`), enough to break up an otherwise all-teal palette
    // without adding mass to the composition. Both sit outside the swim
    // lane (0.32-0.72) so they never crowd the fish.
    { species: "bloom", layer: "front", xFraction: 0.12, scale: 1.0, seed: 401 },
    { species: "bloom", layer: "front", xFraction: 0.85, scale: 0.82, seed: 403 },
    { species: "bloom", layer: "mid", xFraction: 0.24, scale: 0.7, seed: 405 },
  ],
};
