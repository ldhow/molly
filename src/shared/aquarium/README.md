# The aquarium renderer

A second, self-contained 2D tank renderer, selectable via the render-mode
toggle (labelled **2D V2**) alongside the original 2D renderer
(`@/shared/components/tank/tank-canvas.tsx`) and the 3D renderer
(`@/shared/components/tank/tank-canvas-3d.tsx`). See
[`src/docs/aquarium-guide.md`](../../docs/aquarium-guide.md) for the full
design rationale — this file is the quick orientation map.

## Deleting the old 2D renderer

Once this renderer replaces it:

1. Delete `src/shared/components/tank/{fish-sprite,fish-picture,undulating-body,tank-canvas,plants,water-background,bubbles}.tsx`.
2. Delete `src/shared/fish/render-spec.ts` and `scripts/fish-preview.ts` /
   `scripts/lib/fish-svg.ts` / `scripts/fish-color-editor.ts` (the
   declarative/imperative/SVG three-backend pipeline that art targeted).
3. Keep `src/shared/fish/{types,catalog,raster,skin-map}.ts` — the 3D
   renderer still depends on them for skin baking. Fold `fish/pattern-defs.ts`'s
   `OVERRIDES` back into `catalog.ts` at this point (see that file's header)
   — the reason it's a separate override layer (not touching the legacy
   renderer's pattern data) goes away once there's no legacy renderer left.
4. In `render-mode-store.ts`, drop the `"2d"` variant (or rename `"v2"` to
   `"2d"`) and update `tank-view.tsx`'s branch accordingly.
5. Update `CLAUDE.md`'s "How a fish is drawn" section to describe this tree
   instead.

## What imports what

This tree imports only:

- `@/shared/fish/{types,catalog}` — trait/colour DATA, read-only. Never the
  old renderer's components — including `@/shared/hooks/use-fish-swim.ts`:
  this tree owns its own steering (`fish/sim/swim.ts`).
- `@/shared/creature/{types,catalog}` — species DATA (`SpeciesId`,
  `SpeciesDef`, `getSpeciesDef`), read-only, the same role `fish/catalog.ts`
  plays for molly. Only `creatures/` and `render/creature-layer.tsx` touch
  this; every other file in the tree stays species-agnostic.
- `@/shared/lib/{color,rng,seed,path2d}` — dependency-free pure helpers,
  already shared with the 3D renderer.
- `@/shared/constants/*` — generic shared utilities, not renderer code.
- `@/shared/fish/render-spec.ts`'s `DEAD_GRAYSCALE_MATRIX`/`DEAD_OPACITY`
  constants (data, not code) — so dead fish look the same across renderers
  until the old one is deleted.

Nothing outside `src/shared/aquarium/` should import from inside it except
`render/aquarium-canvas.tsx` (via `tank-view.tsx`), `render/creature-preview.tsx`
(via the home-screen picker, Fishdex, and Holding Tank tile — the non-molly
species have no legacy-renderer art to preview through instead), and
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
  composition (`compose.ts`), and the authored theme (`themes/`).
- `sim/` — per-fish steering (`swim.ts`, `use-v2-swim.ts`) and personality
  (`personality.ts`) — shared as-is by every species, molly and otherwise.
- `render/` — React/Skia components: `aquarium-canvas.tsx` (drop-in for
  `TankCanvas`, dispatches each individual to `fish-layer.tsx` or
  `creature-layer.tsx`), `fish-layer.tsx` + `fish-cache.ts` (molly),
  `creature-layer.tsx` + `creature-cache.ts` (the other 5 species) +
  `creature-preview.tsx` (the static non-swimming preview every non-molly UI
  surface uses), `water.tsx`, `scene-layers.tsx`, `decor-cache.ts`,
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
