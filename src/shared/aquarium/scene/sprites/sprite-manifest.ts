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
    file: "assets/images/scene/driftwood-log.png",
    width: 320,
    height: 168,
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
    file: "assets/images/scene/rock-a.png",
    width: 295,
    height: 136,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 0,
  },
  rockB: {
    file: "assets/images/scene/rock-b.png",
    width: 248,
    height: 147,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 0,
  },
  kelp: {
    file: "assets/images/scene/kelp.png",
    width: 190,
    height: 426,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 100,
  },
  tallGrass: {
    file: "assets/images/scene/tall-grass.png",
    width: 222,
    height: 414,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 90,
  },
  rotalaTall: {
    file: "assets/images/scene/rotala-tall.png",
    width: 160,
    height: 341,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 80,
  },
  cabomba: {
    file: "assets/images/scene/cabomba.png",
    width: 146,
    height: 333,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 85,
  },
  anubiasA: {
    file: "assets/images/scene/anubias-a.png",
    width: 168,
    height: 150,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 45,
  },
  anubiasB: {
    file: "assets/images/scene/anubias-b.png",
    width: 204,
    height: 269,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 40,
  },
  fern: {
    file: "assets/images/scene/fern.png",
    width: 134,
    height: 194,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 50,
  },
  mossBall: {
    file: "assets/images/scene/moss-ball.png",
    width: 163,
    height: 141,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 0,
  },
  leafyClump: {
    file: "assets/images/scene/leafy-clump.png",
    width: 156,
    height: 127,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 0,
  },
  grassTuft: {
    file: "assets/images/scene/grass-tuft.png",
    width: 114,
    height: 87,
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
  pebble: {
    file: "assets/images/scene/pebble.png",
    width: 76,
    height: 52,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 0,
  },
  rockHuge: {
    file: "assets/images/scene/rock-huge.png",
    width: 288,
    height: 177,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 0,
  },
  rockSmall: {
    file: "assets/images/scene/rock-small.png",
    width: 197,
    height: 147,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 0,
  },
  leafyBush: {
    file: "assets/images/scene/leafy-bush.png",
    width: 238,
    height: 147,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 20,
  },
  grassSpiky: {
    file: "assets/images/scene/grass-spiky.png",
    width: 181,
    height: 167,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 60,
  },
  pebbleBrown: {
    file: "assets/images/scene/pebble-brown.png",
    width: 62,
    height: 43,
    anchorX: 0.5,
    anchorY: 1.0,
    swayHeight: 0,
  },
};

export type SpriteId = keyof typeof SCENE_SPRITES;
