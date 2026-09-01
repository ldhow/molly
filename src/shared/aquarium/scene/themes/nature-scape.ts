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

import { BACKDROP_FILL } from "../backdrop";
import type { SceneTheme } from "../types";

export const NATURE_SCAPE: SceneTheme = {
  name: "nature-scape",
  swimLanes: [{ xFraction: [0.32, 0.72] }],
  placements: [
    // Far layer: dim, distant silhouettes behind everything else — no fish
    // ever occupy this band (see aquarium-canvas.tsx's `bandOf`). Small
    // kelp/stone echoes of the back-layer edge decor, just enough mass for
    // the parallax drift to actually read as depth. Exempt from the
    // composition invariants exactly like `back` — see verify-aquarium.ts.
    { species: "seiryuStone", layer: "far", xFraction: 0.06, scale: 0.6, seed: 505 },
    { species: "seiryuStone", layer: "far", xFraction: 0.92, scale: 0.55, seed: 507 },

    // Back layer: the substrate itself rises at the sides (real scapes
    // slope up toward the back/edges), framed by tall grass descending in
    // height toward the open centre.
    //
    // KELP IS GONE FROM THIS THEME (the generator still exists; nothing
    // places it). It was three back clumps plus two far ones, framing both
    // edges as a dark silhouette wall. Two problems, and they compounded:
    // at ~20:1 aspect with three non-overlapping fronds and a blunt flat
    // top, a clump read as flat dark PLANKS rather than foliage; and at
    // ~1MB per bake it was the single most expensive species in the tree,
    // eating a third of `render/decor-cache.ts`'s 12MB budget for the worst
    // art in the scene. `scene/backdrop.ts`'s canopy pass now supplies the
    // tall edge mass — as real planting, at a fraction of the bytes. Bring
    // kelp back only if its silhouette gets rebuilt first.
    { species: "substrateMound", layer: "back", xFraction: 0.14, scale: 1.5, seed: 101 },
    { species: "substrateMound", layer: "back", xFraction: 0.88, scale: 1.1, seed: 103 },

    // Procedural backdrop fill (`scene/backdrop.ts`): the far and back layers
    // across the FULL canvas width, so the tank reads as a planted scape
    // rather than two clumps of edge decor around empty water. Confined to
    // far/back, which `verify-aquarium.ts` exempts from the composition
    // invariants — so it cannot disturb any of the curation below.
    //
    // Spread as an IDENTIFIER on purpose. `scripts/lib/placement-patch.ts`
    // brace-scans this array for `{...}` literals keyed by a UNIQUE `seed`,
    // and the fill deliberately REUSES seeds across many placements (that
    // reuse is what bounds its bake count — see backdrop.ts's rule 2). A
    // spread of an identifier has no braces, so the scanner never sees it.
    // Inlining the pieces, or generating them with an inline
    // `Array.from(...).map(() => ({...}))`, would both confuse the scanner
    // AND fill the Scene tab with undraggable ghosts. Tune the fill by
    // editing backdrop.ts's pools, not by dragging.
    ...BACKDROP_FILL,
    { species: "vallisneria", layer: "back", xFraction: 0.03, scale: 1.3, seed: 11 },
    { species: "vallisneria", layer: "back", xFraction: 0.09, scale: 1.15, seed: 23 },
    { species: "vallisneria", layer: "back", xFraction: 0.16, scale: 0.95, seed: 25 },
    { species: "vallisneria", layer: "back", xFraction: 0.24, scale: 0.72, seed: 27 },
    { species: "vallisneria", layer: "back", xFraction: 0.94, scale: 1.05, seed: 41 },
    { species: "vallisneria", layer: "back", xFraction: 0.99, scale: 0.88, seed: 59 },
    { species: "cabomba", layer: "back", xFraction: 0.35, scale: 1.1, seed: 81 },
    { species: "cabomba", layer: "back", xFraction: 0.65, scale: 0.95, seed: 83 },
    { species: "sword", layer: "front", xFraction: 0.65, scale: 0.95, seed: 83 },
    { species: "stemBush", layer: "back", xFraction: 0.83, scale: 0.85, seed: 73 },

    // Mid layer: the driftwood centerpiece (left, dominant), plus a smaller
    // mirrored echo on the right so the two sides read as related but
    // asymmetric, not a mirrored pair. This used to carry anubias mounted on
    // the branches via `attachToId` — removed directly on request ("bỏ lá ra
    // khỏi đá, lũa"); the wood stands bare now, same as the stone below.
    { species: "driftwood", layer: "mid", xFraction: 0.19, scale: 1.35, seed: 3, id: "wood1" },
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

    // Carpet: low ground-cover texture at the swim lane's edges, kept short
    // enough (`CarpetDesign.heightMax`) that it never competes with the
    // taller front/mid pieces for the composition invariants.
    { species: "carpet", layer: "front", xFraction: 0.3, scale: 0.9, seed: 601 },
    { species: "carpet", layer: "front", xFraction: 0.74, scale: 0.8, seed: 603 },
    // Rotala: a warm red-stem accent on the right, breaking up the all-green
    // planting the way the reference photo's ludwigia clump does.
    { species: "rotala", layer: "mid", xFraction: 0.78, scale: 0.75, seed: 611 },
  ],
};
