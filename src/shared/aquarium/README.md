# The aquarium renderer

The 2D tank renderer — official as of the legacy renderer's removal — selectable
via the render-mode toggle (labelled **2D**) alongside the 3D renderer
(`@/shared/components/tank/tank-canvas-3d.tsx`). See
[`src/docs/aquarium-guide.md`](../../docs/aquarium-guide.md) for the full
design rationale — this file is the quick orientation map.

## What imports what

This tree imports only:

- `@/shared/fish/{types,catalog,generated-breed}` — trait/colour DATA,
  read-only. `generated-breed.ts` is the procedural breed generator behind
  `gen:<seed>` colour ids; it's dependency-free plain-Node code like the other
  two, and it declares its own pattern vocabulary (rather than importing this
  tree's `AquariumPattern`) because `catalog.ts` imports it — see
  `fish/generated-pattern.ts` for the compile-time bridge that keeps the two
  unions from drifting. This tree owns its own steering (`sim/swim.ts`), never
  `@/shared/hooks/use-fish-swim.ts` (deleted with the legacy renderer — that
  hook is now 3D-only, unused here).
- `@/shared/creature/{types,catalog}` — species DATA (`SpeciesId`,
  `SpeciesDef`, `getSpeciesDef`), read-only, the same role `fish/catalog.ts`
  plays for molly. Only `creatures/` and `render/creature-layer.tsx` touch
  this; every other file in the tree stays species-agnostic.
- `@/shared/lib/{color,rng,seed,path2d}` — dependency-free pure helpers,
  already shared with the 3D renderer.
- `@/shared/constants/*` — generic shared utilities, not renderer code.
- `@/shared/store/scene-art-store.ts` — the procedural/sprites toggle, read
  only by `render/aquarium-canvas.tsx`.

One deliberate exception: `scene/sprites/sprite-sources.ts` imports from
`@/assets/images/scene/*` (raster PNGs for the "sprites" background art
mode, see `scene/sprites/sprite-manifest.ts`) — the only file in this tree
allowed to, since Metro's asset `require` needs the real bundler and every
other module here stays plain-Node-runnable.

Note `@/shared/fish/render-spec.ts` is intentionally NOT in this list even
though it still exists — the 3D renderer's skin-texture bake depends on it
(`skin-map.ts`/`raster.ts`), which is the only reason it's still around.
`render/dead-fish.ts` holds this tree's own `DEAD_GRAYSCALE_MATRIX`/
`DEAD_OPACITY` copy so `fish-layer.tsx`/`creature-layer.tsx` never need to
reach into `render-spec.ts`.

Nothing outside `src/shared/aquarium/` should import from inside it except
`render/aquarium-canvas.tsx` (via `tank-view.tsx`), `render/fish-preview.tsx`
and `render/creature-preview.tsx` (the static per-tile previews used by the
Holding Tank tile, Fishdex cards, and the home-screen picker), and
`index.ts`'s exports.

## Structure

- `core/` — the IR (`ir.ts`), the one imperative emitter (`emit.ts`), the
  bake/LRU cache (`bake.ts`), and two low-level toolkits shared by every
  creature module: `pigment-toolkit.ts` (rng seeding, `blobPath` for small
  decorative blobs, `ribbonAlongPath`) and `limb-chain.ts` (`circleChain`, a
  tapered chain of overlapping circles for jointed/stalk-like limbs).
  `skia-types.ts` is a type-only bridge so the same emitter runs on-device
  and under Node (`scripts/lib/skia-node.ts`, CanvasKit-backed) with no
  second backend to keep in sync.
- `fish/` — molly only: anatomy (`body-profile.ts`, `profile.ts`, `fins.ts`,
  `anatomy.ts` — an original silhouette, not derived from the legacy
  renderer), pigment/patterns (`pigment.ts`, `pattern-defs.ts`), the
  spec/bake composition (`bake-fish.ts`), and the swim-warp math
  (`spine.ts`).
- `creatures/` — the other 5 species, one directory each
  (`snail/`, `frog/`, `turtle/`, `axolotl/`, `otter/`), each following the
  `{anatomy,limbs?,pigment,bake-creature}.ts` module pattern. `bake-creature.ts`
  (top level, no species subfolder) is the one dispatcher every render path
  goes through; `bake-placeholder.ts` is the rigid-blob fallback for any
  species without a `case` in that dispatcher yet. See
  `src/docs/aquarium-guide.md`'s "Creatures" section for the full picture.
- `scene/` — procedural planted-aquarium decor: generators (`gen/`),
  composition (`compose.ts`), and the authored theme (`themes/`). Its
  sprite-mode counterpart lives alongside it: `sprites/` (the PNG manifest +
  RN `require` sources), `compose-sprites.ts`, and
  `themes/nature-scape-sprites.ts` — see `sprites/sprite-manifest.ts`'s
  header for how the two modes relate.
- `sim/` — per-fish steering (`swim.ts`, `use-v2-swim.ts`) and personality
  (`personality.ts`) — shared as-is by every species, molly and otherwise.
- `render/` — React/Skia components: `aquarium-canvas.tsx` (the tank view,
  dispatches each individual to `fish-layer.tsx` or `creature-layer.tsx`),
  `fish-layer.tsx` + `fish-cache.ts` (molly) + `fish-preview.tsx` (the static
  non-swimming molly preview), `creature-layer.tsx` + `creature-cache.ts`
  (the other 5 species) + `creature-preview.tsx` (its non-molly
  counterpart), `dead-fish.ts` (shared corpse-rendering constants), `water.tsx`,
  `scene-layers.tsx` + `decor-cache.ts` (procedural decor) and
  `sprite-layers.tsx` (its sprite-mode counterpart — `SpriteLayerGroup` +
  `SpriteSubstrate` + `SpriteWater`, no bake/cache since the PNG already is
  the texture), `parallax.tsx` (the shared drift camera both use),
  `bubbles.tsx`.

## Verification

`yarn verify:aquarium` (`scripts/verify-aquarium.ts`) — anatomy invariants
(peduncle shape, fin polygon simplicity, buried-root/tip-clearance) and
body-proportion invariants (the art direction, made checkable) for every
body/tail/dorsal combination, a real bake of all 16 colours, spine-warp
fold-safety, scene-composition invariants, a headless swim trace, and a bake
of every non-molly species × variant through the same `bake-creature.ts`
dispatcher every render path uses (a species graduating from placeholder to
real anatomy is covered automatically, no script change needed) — all
through the same Skia emitter the app uses, via `scripts/lib/skia-node.ts`.
Run it after any change under `fish/`, `creatures/`, `scene/`, or `sim/`.

`yarn aquarium:preview` (`scripts/aquarium-preview.ts`) renders every
colour × life stage, every body/tail/dorsal combo, a yaw strip, a
full-scene composite, and every non-molly species × variant to
`src/docs/aquarium-preview.html` — the visual iteration loop, since there's
no device in this environment.
