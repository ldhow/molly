// Data-only description of the shipped-PNG art path (approach "B" in the
// procedural-vs-sprite A/B comparison — see `render/sprite-layers.tsx` for
// the renderer and `scene/compose-sprites.ts` for placement).
//
// The entries below are real painted art — individual pieces cropped out of
// hand-supplied sprite sheets (`assets/images/scene/pieces.png`, and
// `scene.png` for an earlier batch — see that folder's README for exactly
// which piece came from which) via `scripts/extract-scene-pieces.ts`'s
// connected-component detection.
//
// If this record is ever empty, everything that consumes it
// (compose-sprites.ts, sprite-sources.ts, sprite-layers.tsx, the preview
// composite, the verify script's sprite section) degrades to "nothing to
// draw" / "no sprite assets supplied" rather than crashing.
//
// To add or replace a sprite:
//   1. Drop a PNG (with alpha, bottom-center anchor for grounded pieces)
//      into `assets/images/scene/`.
//   2. Add one entry below — `id` is whatever you name the key.
//   3. Add the matching `require(...)` in `sprite-sources.ts` (RN-only,
//      kept separate so this file stays plain data, importable from Node
//      tooling without pulling in a native asset resolver).
//   4. Reference the id from a placement in `themes/nature-scape-sprites.ts`.
//
// This record is also the id space `@/shared/decor/catalog.ts` (the Decor
// Store's priced item list) is keyed against, and `db/schema.ts`'s
// `decorItems.itemId` stores these ids directly. REMOVING an entry orphans
// any `decor_items` row that references it — the row survives (nothing here
// deletes it), the piece just stops rendering, same "skip rather than throw"
// contract `compose-sprites.ts` already has for an unknown `spriteId`. Add a
// data migration if you ever need to refund an orphaned purchase.
//
// Dependency-free — no React/RN/Skia imports — so Node tooling
// (aquarium-preview.ts, verify-aquarium.ts) can read it directly.

export interface SceneSprite {
  /** Repo-relative path, for Node tooling that reads the PNG off disk (preview/verify) — not used at runtime, RN resolves via `sprite-sources.ts`'s `require`. */
  file: string;
  /** Intrinsic size in logical px at scale=1. */
  width: number;
  height: number;
  /** Fraction of the sprite's own width/height where its "ground" point sits — (0.5, 1) for a piece resting on the substrate by its horizontal center. */
  anchorX: number;
  anchorY: number;
  /** How far this piece sways above its base — 0 for hardscape (driftwood, rock, sand, pebble), >0 for planted pieces, same semantics as `GeneratedPiece.swayHeight`. */
  swayHeight: number;
}

export const SCENE_SPRITES: Record<string, SceneSprite> = {
  // Anchor is bottom-center (0.5, 1.0) for every piece — a reasonable
  // default for "resting on the substrate" without hand-judging each
  // asymmetric silhouette; nudge per-piece if one reads as floating/sunk
  // once seen on device.
  driftwoodLog: {
    file: "assets/images/scene3d/driftwood-3.png",
    width: 320,
    height: 172,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 0,
  },
  driftwoodBranch: {
    file: "assets/images/scene/driftwood-branch.png",
    width: 93,
    height: 205,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 0,
  },
  driftwoodBranch2: {
    file: "assets/images/scene/driftwood-branch2.png",
    width: 78,
    height: 172,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 0,
  },
  rockA: {
    file: "assets/images/scene3d/rock-3.png",
    width: 295,
    height: 161,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 0,
  },
  rockB: {
    file: "assets/images/scene3d/rock-11.png",
    width: 248,
    height: 136,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 0,
  },
  kelp: {
    file: "assets/images/scene3d/kelp-3.png",
    width: 284,
    height: 426,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 100,
  },
  tallGrass: {
    file: "assets/images/scene3d/grass-3.png",
    width: 276,
    height: 414,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 90,
  },
  rotalaTall: {
    file: "assets/images/scene3d/cabomba-11.png",
    width: 199,
    height: 341,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 80,
  },
  cabomba: {
    file: "assets/images/scene3d/cabomba-3.png",
    width: 194,
    height: 333,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 85,
  },
  anubiasA: {
    file: "assets/images/scene3d/anubias-3.png",
    width: 168,
    height: 137,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 45,
  },
  anubiasB: {
    file: "assets/images/scene3d/anubias-11.png",
    width: 269,
    height: 219,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 40,
  },
  fern: {
    file: "assets/images/scene3d/bush-3.png",
    width: 194,
    height: 123,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 50,
  },
  mossBall: {
    file: "assets/images/scene3d/mossball-3.png",
    width: 163,
    height: 136,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 0,
  },
  leafyClump: {
    file: "assets/images/scene3d/bush-11.png",
    width: 156,
    height: 99,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 0,
  },
  grassTuft: {
    file: "assets/images/scene3d/grass-11.png",
    width: 76,
    height: 114,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 30,
  },
  sandPatch: {
    file: "assets/images/scene/sand-patch.png",
    width: 421,
    height: 125,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 0,
  },
  rockHuge: {
    file: "assets/images/scene3d/rock-3.png",
    width: 288,
    height: 158,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 0,
  },
  rockSmall: {
    file: "assets/images/scene3d/rocksmall-3.png",
    width: 197,
    height: 129,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 0,
  },
  leafyBush: {
    file: "assets/images/scene3d/bush-3.png",
    width: 238,
    height: 151,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 20,
  },
  grassSpiky: {
    file: "assets/images/scene3d/sword-3.png",
    width: 145,
    height: 181,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 60,
  },

  // --- Blender-rendered pieces (approach "C") ------------------------------
  //
  // Orthographic renders of real 3D geometry from `scripts/blender/plant.py`,
  // catalogued in `blender-manifest.ts` and regenerated by `yarn decor:blender`.
  // They live in THIS record, not a parallel one, so a theme can place them
  // with the same `compose-sprites.ts` machinery the painted set uses — a
  // theme should not have to care how a PNG was authored.
  //
  // ADDING ids here is safe: the Decor Store's price list
  // (`@/shared/decor/catalog.ts`) is a hand-written array, so nothing becomes
  // purchasable merely by appearing here. REMOVING one is what orphans a
  // `decor_items` row — see this file's header.
  //
  // `width`/`height` are matched to each piece's painted counterpart so theme
  // scales transfer, but the PNGs behind them are rendered at 2-4x that. That
  // is the point: the painted set breaks past ~1.7x, these do not.
  b3Sword: {
    file: "assets/images/scene3d/sword-3.png",
    width: 200,
    height: 260,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 20,
  },
  b3SwordB: {
    file: "assets/images/scene3d/sword-11.png",
    width: 200,
    height: 260,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 20,
  },
  b3Grass: {
    file: "assets/images/scene3d/grass-3.png",
    width: 222,
    height: 414,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 60,
  },
  b3GrassB: {
    file: "assets/images/scene3d/grass-11.png",
    width: 222,
    height: 414,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 60,
  },
  b3Kelp: {
    file: "assets/images/scene3d/kelp-3.png",
    width: 190,
    height: 426,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 150,
  },
  b3KelpB: {
    file: "assets/images/scene3d/kelp-11.png",
    width: 190,
    height: 426,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 150,
  },
  b3Anubias: {
    file: "assets/images/scene3d/anubias-3.png",
    width: 168,
    height: 150,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 14,
  },
  b3AnubiasB: {
    file: "assets/images/scene3d/anubias-11.png",
    width: 168,
    height: 150,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 14,
  },
  b3Cabomba: {
    file: "assets/images/scene3d/cabomba-3.png",
    width: 146,
    height: 333,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 110,
  },
  b3CabombaB: {
    file: "assets/images/scene3d/cabomba-11.png",
    width: 146,
    height: 333,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 110,
  },
  b3Rock: {
    file: "assets/images/scene3d/rock-3.png",
    width: 295,
    height: 136,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 0,
  },
  b3RockB: {
    file: "assets/images/scene3d/rock-11.png",
    width: 295,
    height: 136,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 0,
  },
  b3Rocksmall: {
    file: "assets/images/scene3d/rocksmall-3.png",
    width: 197,
    height: 147,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 0,
  },
  b3RocksmallB: {
    file: "assets/images/scene3d/rocksmall-11.png",
    width: 197,
    height: 147,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 0,
  },
  b3Driftwood: {
    file: "assets/images/scene3d/driftwood-3.png",
    width: 320,
    height: 168,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 0,
  },
  b3DriftwoodB: {
    file: "assets/images/scene3d/driftwood-11.png",
    width: 320,
    height: 168,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 0,
  },
  b3Mossball: {
    file: "assets/images/scene3d/mossball-3.png",
    width: 163,
    height: 141,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 0,
  },
  b3MossballB: {
    file: "assets/images/scene3d/mossball-11.png",
    width: 163,
    height: 141,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 0,
  },
  b3Bush: {
    file: "assets/images/scene3d/bush-3.png",
    width: 238,
    height: 147,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 20,
  },
  b3BushB: {
    file: "assets/images/scene3d/bush-11.png",
    width: 238,
    height: 147,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 20,
  },
};

export type SpriteId = keyof typeof SCENE_SPRITES;
