// Data-only description of the BLENDER-RENDERED decor path — approach "C",
// alongside `sprite-manifest.ts`'s painted PNGs (approach "B") and
// `scene/gen/*.ts`'s Skia-drawn pieces (approach "A").
//
// These PNGs are not painted and not drawn with Skia: they are orthographic
// renders of real 3D geometry, produced by `scripts/blender/plant.py` and
// driven by `scripts/render-blender-decor.ts`. The point is the five things
// a flat Skia ribbon cannot express and a painted PNG can only fake once, at
// one size — a folded blade lit as two surfaces, lateral venation, an
// undulate margin, light transmitted THROUGH a leaf, and foreshortening that
// narrows a turned leaf instead of merely darkening it.
//
// DELIBERATELY SEPARATE FROM `SCENE_SPRITES`. That record is the id space
// `@/shared/decor/catalog.ts` prices and `db/schema.ts`'s `decorItems.itemId`
// stores, so adding ids there is a product decision with a migration
// attached, not a rendering one. Keeping approach "C" in its own record lets
// the preview compare all three head to head while the app's decor economy
// stays exactly as it was. Promoting a piece into `SCENE_SPRITES` later is a
// copy-paste plus a `sprite-sources.ts` `require`.
//
// Each entry has up to three files. `normal` is written in
// `fish/normal-map.ts`'s encoding (R = nx*0.5+0.5, G = ny*0.5+0.5, B = mask,
// A = 255) so a piece can eventually feed the same relight path the fish
// already use; nothing reads it yet.
//
// Dependency-free — no React/RN/Skia imports — so Node tooling
// (aquarium-preview.ts, verify-aquarium.ts) can read it directly. If the
// files are missing, every consumer must degrade to "nothing to draw" the
// same way `sprite-manifest.ts`'s consumers do, because these renders are
// gitignored-by-size in some checkouts and regenerated on demand.

import type { SpeciesId } from "../types";

export interface BlenderPiece {
  /** Repo-relative path to the lit render, for Node tooling that reads it off disk. */
  file: string;
  /** Repo-relative path to the camera-space normal map, or null if not rendered. */
  normal: string | null;
  /** Repo-relative path to the linear 0..1 depth pass, or null if not rendered. */
  depth: string | null;
  /**
   * Pixel resolution to RENDER at, which is deliberately not `width`/`height`.
   * Those are LOGICAL sizes the renderer scales the PNG into (matched to the
   * painted counterpart so a theme's scales carry over); this is how much
   * real detail is behind them. Raising it costs render time and bytes and
   * nothing else - there is no source-art ceiling here, which is the whole
   * advantage over the fixed-resolution painted set.
   */
  renderRes: string;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  swayHeight: number;
  /**
   * The `scene/gen/*.ts` generator this piece is the 3D counterpart of, and
   * the `SCENE_SPRITES` id of the painted art both are modelled on — the two
   * things the preview puts it side by side with. `null` where no
   * counterpart exists.
   */
  generatedSpecies: SpeciesId | null;
  paintedSpriteId: string | null;
}

/**
 * Renders live under `assets/images/scene3d/`, one directory per species,
 * `<species>-<seed>.png`. Regenerate with `yarn decor:blender`.
 */
export const BLENDER_PIECES: Record<string, BlenderPiece> = {
  b3Sword: {
    file: "assets/images/scene3d/sword-3.png",
    normal: "assets/images/scene3d/sword-3-normal.png",
    depth: "assets/images/scene3d/sword-3-depth.png",
    renderRes: "512x640",
    width: 200,
    height: 260,
    anchorX: 0.5,
    anchorY: 0.946,
    swayHeight: 20,
    generatedSpecies: "sword",
    paintedSpriteId: "grassSpiky",
  },
  b3SwordB: {
    file: "assets/images/scene3d/sword-11.png",
    normal: "assets/images/scene3d/sword-11-normal.png",
    depth: "assets/images/scene3d/sword-11-depth.png",
    renderRes: "512x640",
    width: 200,
    height: 260,
    anchorX: 0.5,
    anchorY: 0.946,
    swayHeight: 20,
    generatedSpecies: "sword",
    paintedSpriteId: "grassSpiky",
  },
  b3Grass: {
    file: "assets/images/scene3d/grass-3.png",
    normal: "assets/images/scene3d/grass-3-normal.png",
    depth: "assets/images/scene3d/grass-3-depth.png",
    renderRes: "512x768",
    width: 222,
    height: 414,
    anchorX: 0.5,
    anchorY: 0.946,
    swayHeight: 60,
    generatedSpecies: "vallisneria",
    paintedSpriteId: "tallGrass",
  },
  b3GrassB: {
    file: "assets/images/scene3d/grass-11.png",
    normal: "assets/images/scene3d/grass-11-normal.png",
    depth: "assets/images/scene3d/grass-11-depth.png",
    renderRes: "512x768",
    width: 222,
    height: 414,
    anchorX: 0.5,
    anchorY: 0.946,
    swayHeight: 60,
    generatedSpecies: "vallisneria",
    paintedSpriteId: "tallGrass",
  },
  b3Kelp: {
    file: "assets/images/scene3d/kelp-3.png",
    normal: "assets/images/scene3d/kelp-3-normal.png",
    depth: "assets/images/scene3d/kelp-3-depth.png",
    renderRes: "512x768",
    width: 190,
    height: 426,
    anchorX: 0.5,
    anchorY: 0.946,
    swayHeight: 150,
    generatedSpecies: "kelp",
    paintedSpriteId: "kelp",
  },
  b3KelpB: {
    file: "assets/images/scene3d/kelp-11.png",
    normal: "assets/images/scene3d/kelp-11-normal.png",
    depth: "assets/images/scene3d/kelp-11-depth.png",
    renderRes: "512x768",
    width: 190,
    height: 426,
    anchorX: 0.5,
    anchorY: 0.946,
    swayHeight: 150,
    generatedSpecies: "kelp",
    paintedSpriteId: "kelp",
  },
  b3Anubias: {
    file: "assets/images/scene3d/anubias-3.png",
    normal: "assets/images/scene3d/anubias-3-normal.png",
    depth: "assets/images/scene3d/anubias-3-depth.png",
    renderRes: "640x520",
    width: 168,
    height: 150,
    anchorX: 0.5,
    anchorY: 0.946,
    swayHeight: 14,
    generatedSpecies: "anubias",
    paintedSpriteId: "anubiasA",
  },
  b3AnubiasB: {
    file: "assets/images/scene3d/anubias-11.png",
    normal: "assets/images/scene3d/anubias-11-normal.png",
    depth: "assets/images/scene3d/anubias-11-depth.png",
    renderRes: "640x520",
    width: 168,
    height: 150,
    anchorX: 0.5,
    anchorY: 0.946,
    swayHeight: 14,
    generatedSpecies: "anubias",
    paintedSpriteId: "anubiasA",
  },
  b3Cabomba: {
    file: "assets/images/scene3d/cabomba-3.png",
    normal: "assets/images/scene3d/cabomba-3-normal.png",
    depth: "assets/images/scene3d/cabomba-3-depth.png",
    renderRes: "448x768",
    width: 146,
    height: 333,
    anchorX: 0.5,
    anchorY: 0.946,
    swayHeight: 110,
    generatedSpecies: "cabomba",
    paintedSpriteId: "cabomba",
  },
  b3CabombaB: {
    file: "assets/images/scene3d/cabomba-11.png",
    normal: "assets/images/scene3d/cabomba-11-normal.png",
    depth: "assets/images/scene3d/cabomba-11-depth.png",
    renderRes: "448x768",
    width: 146,
    height: 333,
    anchorX: 0.5,
    anchorY: 0.946,
    swayHeight: 110,
    generatedSpecies: "cabomba",
    paintedSpriteId: "cabomba",
  },
  b3Rock: {
    file: "assets/images/scene3d/rock-3.png",
    normal: "assets/images/scene3d/rock-3-normal.png",
    depth: "assets/images/scene3d/rock-3-depth.png",
    renderRes: "768x420",
    width: 295,
    height: 136,
    anchorX: 0.5,
    anchorY: 0.946,
    swayHeight: 0,
    generatedSpecies: "seiryuStone",
    paintedSpriteId: "rockA",
  },
  b3RockB: {
    file: "assets/images/scene3d/rock-11.png",
    normal: "assets/images/scene3d/rock-11-normal.png",
    depth: "assets/images/scene3d/rock-11-depth.png",
    renderRes: "768x420",
    width: 295,
    height: 136,
    anchorX: 0.5,
    anchorY: 0.946,
    swayHeight: 0,
    generatedSpecies: "seiryuStone",
    paintedSpriteId: "rockA",
  },
  b3Rocksmall: {
    file: "assets/images/scene3d/rocksmall-3.png",
    normal: "assets/images/scene3d/rocksmall-3-normal.png",
    depth: "assets/images/scene3d/rocksmall-3-depth.png",
    renderRes: "640x420",
    width: 197,
    height: 147,
    anchorX: 0.5,
    anchorY: 0.946,
    swayHeight: 0,
    generatedSpecies: "seiryuStone",
    paintedSpriteId: "rockSmall",
  },
  b3RocksmallB: {
    file: "assets/images/scene3d/rocksmall-11.png",
    normal: "assets/images/scene3d/rocksmall-11-normal.png",
    depth: "assets/images/scene3d/rocksmall-11-depth.png",
    renderRes: "640x420",
    width: 197,
    height: 147,
    anchorX: 0.5,
    anchorY: 0.946,
    swayHeight: 0,
    generatedSpecies: "seiryuStone",
    paintedSpriteId: "rockSmall",
  },
  b3Driftwood: {
    file: "assets/images/scene3d/driftwood-3.png",
    normal: "assets/images/scene3d/driftwood-3-normal.png",
    depth: "assets/images/scene3d/driftwood-3-depth.png",
    renderRes: "832x448",
    width: 320,
    height: 168,
    anchorX: 0.5,
    anchorY: 0.946,
    swayHeight: 0,
    generatedSpecies: "driftwood",
    paintedSpriteId: "driftwoodLog",
  },
  b3DriftwoodB: {
    file: "assets/images/scene3d/driftwood-11.png",
    normal: "assets/images/scene3d/driftwood-11-normal.png",
    depth: "assets/images/scene3d/driftwood-11-depth.png",
    renderRes: "832x448",
    width: 320,
    height: 168,
    anchorX: 0.5,
    anchorY: 0.946,
    swayHeight: 0,
    generatedSpecies: "driftwood",
    paintedSpriteId: "driftwoodLog",
  },
  b3Mossball: {
    file: "assets/images/scene3d/mossball-3.png",
    normal: "assets/images/scene3d/mossball-3-normal.png",
    depth: "assets/images/scene3d/mossball-3-depth.png",
    renderRes: "576x480",
    width: 163,
    height: 141,
    anchorX: 0.5,
    anchorY: 0.946,
    swayHeight: 0,
    generatedSpecies: "carpet",
    paintedSpriteId: "mossBall",
  },
  b3MossballB: {
    file: "assets/images/scene3d/mossball-11.png",
    normal: "assets/images/scene3d/mossball-11-normal.png",
    depth: "assets/images/scene3d/mossball-11-depth.png",
    renderRes: "576x480",
    width: 163,
    height: 141,
    anchorX: 0.5,
    anchorY: 0.946,
    swayHeight: 0,
    generatedSpecies: "carpet",
    paintedSpriteId: "mossBall",
  },
  b3Bush: {
    file: "assets/images/scene3d/bush-3.png",
    normal: "assets/images/scene3d/bush-3-normal.png",
    depth: "assets/images/scene3d/bush-3-depth.png",
    renderRes: "704x448",
    width: 238,
    height: 147,
    anchorX: 0.5,
    anchorY: 0.946,
    swayHeight: 20,
    generatedSpecies: "stemBush",
    paintedSpriteId: "leafyBush",
  },
  b3BushB: {
    file: "assets/images/scene3d/bush-11.png",
    normal: "assets/images/scene3d/bush-11-normal.png",
    depth: "assets/images/scene3d/bush-11-depth.png",
    renderRes: "704x448",
    width: 238,
    height: 147,
    anchorX: 0.5,
    anchorY: 0.946,
    swayHeight: 20,
    generatedSpecies: "stemBush",
    paintedSpriteId: "leafyBush",
  },
};

export type BlenderPieceId = keyof typeof BLENDER_PIECES;

/**
 * Painted `SCENE_SPRITES` id -> the Blender-rendered piece that replaces it.
 *
 * WHY THIS SHAPE. The app's tank does not render a theme — `aquarium-canvas.tsx`
 * renders `userScape`, built from the player's own purchased `decor_items`
 * rows. Those rows store a `DECOR_CATALOG` id, which IS a `SCENE_SPRITES` key.
 * So the entire tank's art is decided by which PNG each of those 20 keys
 * points at, and swapping the art is a matter of repointing `file` — no
 * migration, no catalog edit, and every already-purchased piece re-renders in
 * the new art keeping its position, scale and layer.
 *
 * To apply, in `sprite-manifest.ts`, set each listed key's `file` to
 * `BLENDER_PIECES[<value>].file`. To revert, put the `assets/images/scene/`
 * path back. Nothing else changes.
 *
 * `sandPatch` is deliberately absent: it is the substrate itself, stretched
 * edge to edge by `render/sprite-layers.tsx`'s `SpriteSubstrate`, not a decor
 * piece, and there is no 3D equivalent.
 *
 * NOT APPLIED. As of writing the painted art still reads better — richer
 * colour and no faceting on the hardscape — so switching wholesale would be a
 * visible downgrade. See `scripts/blender/plant.py`'s palette notes for what
 * closing that gap needs.
 */
export const BLENDER_SUBSTITUTIONS: Record<string, string> = {
  grassSpiky: "b3Sword",
  tallGrass: "b3Grass",
  grassTuft: "b3GrassB",
  kelp: "b3Kelp",
  anubiasA: "b3Anubias",
  anubiasB: "b3AnubiasB",
  cabomba: "b3Cabomba",
  rotalaTall: "b3CabombaB",
  fern: "b3Bush",
  leafyBush: "b3Bush",
  leafyClump: "b3BushB",
  mossBall: "b3Mossball",
  rockA: "b3Rock",
  rockB: "b3RockB",
  rockHuge: "b3Rock",
  rockSmall: "b3Rocksmall",
  driftwoodLog: "b3Driftwood",
  driftwoodBranch: "b3DriftwoodB",
  driftwoodBranch2: "b3DriftwoodB",
};
