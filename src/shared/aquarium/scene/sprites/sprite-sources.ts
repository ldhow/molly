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
  pebble: require("@/assets/images/scene/pebble.png"),
  rockHuge: require("@/assets/images/scene/rock-huge.png"),
  rockSmall: require("@/assets/images/scene/rock-small.png"),
  leafyBush: require("@/assets/images/scene/leafy-bush.png"),
  grassSpiky: require("@/assets/images/scene/grass-spiky.png"),
  pebbleBrown: require("@/assets/images/scene/pebble-brown.png"),
};
