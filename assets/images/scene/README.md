# Aquarium scene sprites

PNG art for the 2D tank's "sprites" background mode — the shipped-art
alternative to the default procedural decor, for A/B comparison. See
`src/shared/aquarium/scene/sprites/sprite-manifest.ts` for the full process;
short version:

1. Drop a PNG here (with alpha, bottom-center anchor for anything that sits
   on the substrate).
2. Add an entry to `SCENE_SPRITES` in `sprite-manifest.ts`.
3. Add the matching `require("@/assets/images/scene/<file>.png")` to
   `SPRITE_SOURCES` in `sprite-sources.ts`.
4. Reference the sprite id from a placement in
   `src/shared/aquarium/scene/themes/nature-scape-sprites.ts`.

The 22 individual pieces currently here (`driftwood-log`, `driftwood-branch`,
`driftwood-branch2`, `rock-a`/`rock-b`/`rock-huge`/`rock-small`, `kelp`,
`tall-grass`, `grass-spiky`, `grass-tuft`, `rotala-tall`, `cabomba`,
`anubias-a`/`anubias-b`, `fern`, `moss-ball`, `leafy-clump`, `leafy-bush`,
`sand-patch`, `pebble`, `pebble-brown`) are real painted art, cropped via
`scripts/extract-scene-pieces.ts` (connected-component detection, with
alpha reconstruction for sheets that need it — see below) from two
hand-supplied sheets:

- `pieces.png` — the current, primary source; a pure piece sheet (no
  reference strip) that's been through several revisions as the art
  improved (most recently a 46-piece sheet with a fuller size range per
  category — e.g. six rock sizes, four driftwood clusters) — nearly every
  piece here came from it; only `fern` and `grass-tuft` have no equivalent
  in the latest revision and were left as-is from an earlier one. Run as
  `extract-scene-pieces.ts pieces.png 0` (`stripBottom=0` since the whole
  sheet is pieces, nothing to skip).
- `scene.png` — now just a clean, standalone STYLE REFERENCE (palette,
  mood, left/right composition balance) matching what the sprite-mode theme
  aims for — not cropped from, not drawn directly. An earlier revision had
  it as a sheet with a reference strip on top and pieces below
  (`extract-scene-pieces.ts scene.png` — `stripBottom` defaults to 470);
  now it's just the reference image on its own.

Whether a given sheet needs alpha reconstruction varies by revision (some
exports carry real alpha, some bake a "checker"/"glow" backdrop into opaque
pixels instead) — the extraction script auto-detects which and only
reconstructs (via a whiteness threshold) when needed; see its header.

The sprite-mode art is assembled from these individual pieces, composed to
read close to `scene.png`'s balance (driftwood + rock + anubias + a warm
accent on BOTH sides, not the procedural theme's deliberate left-heavy
asymmetry) — see `scene/themes/nature-scape-sprites.ts`.

`sand-patch.png` is a rounded clump, not a straight strip, so
`render/sprite-layers.tsx`'s `SpriteSubstrate` draws a solid gradient fill
(sampled from the patch's own tone) underneath it before stretching the
patch to the full canvas width — otherwise the patch's curved edge would
show water peeking through at the canvas corners.

If this folder is ever emptied, see `sprite-manifest.ts`'s header for what
"empty" degrades to in the app, the preview, and `verify:aquarium`.
