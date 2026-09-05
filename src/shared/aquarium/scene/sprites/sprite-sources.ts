// The one file in this tree allowed to import from `@/assets` (see the
// aquarium README's import allowlist) — `require(...)`ing a raster asset
// needs Metro's native asset resolution, which is unavailable to the
// Node-side tooling that reads `sprite-manifest.ts` directly. Keeping the
// `require` calls isolated here is what lets everything else in `scene/`
// stay plain, Node-runnable data/logic.
//
// Every key here must have a matching entry in `SCENE_SPRITES` — see that
// file's header for how to add or replace one.

import type { SpriteId } from "./sprite-manifest";

/* eslint-disable @typescript-eslint/no-require-imports */
export const SPRITE_SOURCES: Record<SpriteId, number> = {
  driftwoodLog: require("@/assets/images/scene/driftwood-log.png"),
  driftwoodBranch: require("@/assets/images/scene/driftwood-branch.png"),
  driftwoodBranch2: require("@/assets/images/scene/driftwood-branch2.png"),
  rockA: require("@/assets/images/scene/rock-a.png"),
  rockB: require("@/assets/images/scene/rock-b.png"),
  kelp: require("@/assets/images/scene/kelp.png"),
  tallGrass: require("@/assets/images/scene/tall-grass.png"),
  rotalaTall: require("@/assets/images/scene/rotala-tall.png"),
  cabomba: require("@/assets/images/scene/cabomba.png"),
  anubiasA: require("@/assets/images/scene/anubias-a.png"),
  anubiasB: require("@/assets/images/scene/anubias-b.png"),
  fern: require("@/assets/images/scene/fern.png"),
  mossBall: require("@/assets/images/scene/moss-ball.png"),
  leafyClump: require("@/assets/images/scene/leafy-clump.png"),
  grassTuft: require("@/assets/images/scene/grass-tuft.png"),
  sandPatch: require("@/assets/images/scene/sand-patch.png"),
  rockHuge: require("@/assets/images/scene/rock-huge.png"),
  rockSmall: require("@/assets/images/scene/rock-small.png"),
  leafyBush: require("@/assets/images/scene/leafy-bush.png"),
  grassSpiky: require("@/assets/images/scene/grass-spiky.png"),

  // Blender-rendered pieces — see the section of the same name in
  // `sprite-manifest.ts`. Same `require` contract as everything above.
  b3Sword: require("@/assets/images/scene3d/sword-3.png"),
  b3SwordB: require("@/assets/images/scene3d/sword-11.png"),
  b3Grass: require("@/assets/images/scene3d/grass-3.png"),
  b3GrassB: require("@/assets/images/scene3d/grass-11.png"),
  b3Kelp: require("@/assets/images/scene3d/kelp-3.png"),
  b3KelpB: require("@/assets/images/scene3d/kelp-11.png"),
  b3Anubias: require("@/assets/images/scene3d/anubias-3.png"),
  b3AnubiasB: require("@/assets/images/scene3d/anubias-11.png"),
  b3Cabomba: require("@/assets/images/scene3d/cabomba-3.png"),
  b3CabombaB: require("@/assets/images/scene3d/cabomba-11.png"),
  b3Rock: require("@/assets/images/scene3d/rock-3.png"),
  b3RockB: require("@/assets/images/scene3d/rock-11.png"),
  b3Rocksmall: require("@/assets/images/scene3d/rocksmall-3.png"),
  b3RocksmallB: require("@/assets/images/scene3d/rocksmall-11.png"),
  b3Driftwood: require("@/assets/images/scene3d/driftwood-3.png"),
  b3DriftwoodB: require("@/assets/images/scene3d/driftwood-11.png"),
  b3Mossball: require("@/assets/images/scene3d/mossball-3.png"),
  b3MossballB: require("@/assets/images/scene3d/mossball-11.png"),
  b3Bush: require("@/assets/images/scene3d/bush-3.png"),
  b3BushB: require("@/assets/images/scene3d/bush-11.png"),
};
