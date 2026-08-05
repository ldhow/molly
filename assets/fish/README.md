# Fish sprite art pack — OPTIONAL OVERRIDE, not the shipping path

> **This is no longer how fish are drawn.** The app renders them procedurally
> from `src/shared/fish/render-spec.ts`, because a fish is four independent
> trait axes (~480 combinations) and a sprite manifest keyed by colour cannot
> show a rolled balloon body, lyretail, or sailfin. See the "How a fish is
> drawn" section of `CLAUDE.md`, and iterate with `yarn fish:preview`.
>
> The sprite path below still works and still takes precedence for any colour
> you register — use it to hand-author a single showpiece variety, not to
> replace the renderer. Note the variant list further down predates the
> colour × traits split and no longer matches `ColorId`.

To use it: generate the images below, save them here, and register them in
`src/shared/lib/sprites.ts`.

## Spec (all images)

- **Format**: PNG with a fully transparent background (no water, no shadow).
- **Orientation**: side view, fish facing **LEFT**, horizontal, centered.
- **Size**: 512×320 px for adults (fish fills ~90% of width); egg/fry can be 256px.
- **Consistency**: same camera angle, same soft top-light, photographic style
  across every variant — generate them in one session with the same base prompt.
- **Files**: `assets/fish/<variantId>/<stage>.png`, e.g. `assets/fish/black/adult.png`.
  Minimum viable set: 7 × `adult.png`, plus one shared `egg.png` and `fry.png`
  (put them under `assets/fish/shared/`). `juvenile` falls back to the adult
  sprite at reduced scale if missing.

## Base prompt

> Photorealistic aquarium photography of a single {VARIANT} molly fish
> (Poecilia), full side view facing left, fins spread naturally, sharp focus,
> soft diffused studio lighting from above, isolated on a plain background,
> no reflections, no water surface, high detail scales and translucent fins.

Then remove the background (most tools can output transparency directly; else
use a background remover).

## Variant descriptions ({VARIANT})

| variantId   | Prompt fragment                                                              |
| ----------- | ---------------------------------------------------------------------------- |
| `black`     | jet-black molly, velvet matte black body and fins                            |
| `goldDust`  | gold dust molly, golden-orange body with fine dark speckling toward the tail |
| `dalmatian` | dalmatian molly, white body densely speckled with irregular black spots      |
| `sailfin`   | sailfin molly, silver-green body with a very tall spread dorsal fin          |
| `balloon`   | balloon molly, short round balloon-shaped body, cream and gold coloring      |
| `lyretail`  | lyretail molly, silver-blue body with an elegant lyre-shaped forked tail     |
| `marble`    | marble molly, pearl-white body with bold swirled black marble patches        |

Shared stages:

- `egg.png`: single translucent amber fish egg, macro photo style.
- `fry.png`: tiny newborn molly fry, slim silver body, facing left.

## Registering

```ts
// src/shared/lib/sprites.ts
const FISH_SPRITES = {
  black: { adult: require("@/assets/fish/black/adult.png") },
  goldDust: { adult: require("@/assets/fish/goldDust/adult.png") },
  // ...
};
```
