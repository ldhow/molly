# Fish art editing guide

Practical map of [render-spec.ts](../shared/fish/render-spec.ts) for pure art changes — reshaping the body, tails, fins, or colors. Read the "How a fish is drawn" section of [CLAUDE.md](../../CLAUDE.md) first for the three-backend architecture this file assumes.

## Tools

[scripts/fish-path-editor.html](../../scripts/fish-path-editor.html) is a standalone visual editor for the fish's Bézier shapes — open it directly in a browser (no build/server needed). It lets you draw and drag body/fin outlines by hand, load the shapes currently shipping as a starting point, and export `d` path strings plus landmark/pivot objects formatted to paste straight into the functions below. It also renders a live composited preview of all parts together with a rough color fill, so you can sanity-check a shape without round-tripping through `yarn fish:preview`.

`yarn fish:colors` is the equivalent tool for **colors** rather than shapes — see [Configuring fish colors](#configuring-fish-colors) below.

For pure art changes you only ever need to touch **one file** — `render-spec.ts`. It's the single IR (intermediate representation) that all three backends (Skia declarative, Skia imperative, SVG preview) interpret generically as `path`/`circle`/`group` primitives, so editing coordinates/paints inside existing primitive kinds doesn't require touching the other backends at all. You only need to touch `fish-sprite.tsx`, `fish-picture.ts`, and `fish-preview.ts` if you add a **brand-new `Primitive`/`Paint` kind** to the union (e.g. a new blend mode or paint type) — see the header comment at `render-spec.ts:1-42`.

## Where each part lives

| What you want to change                                                        | Function                    | Lines                      |
| ------------------------------------------------------------------------------ | --------------------------- | -------------------------- |
| Body outline shape (standard + balloon)                                        | `bodyGeom()`                | `render-spec.ts:504-555`   |
| Tail shape (round + lyretail)                                                  | `tailGeom()`                | `render-spec.ts:557-609`   |
| Dorsal fin (standard + sailfin)                                                | `dorsalGeom()`              | `render-spec.ts:617-689`   |
| Pelvic / anal fins (position, size, sweep)                                     | inline in `buildFishSpec()` | `render-spec.ts:1121-1156` |
| Pectoral fin                                                                   | inline in `buildFishSpec()` | `render-spec.ts:1355-1366` |
| How a fin renders (membrane gradient, ray lines, sheen, outline)               | `finPaint()` / `pushFin()`  | `render-spec.ts:1056-1109` |
| Generic scalloped/radial fin fan builder (shared by tail/pelvic/anal/pectoral) | `fan()`                     | `render-spec.ts:446-487`   |
| Body base color gradient (back→belly)                                          | inline in `buildFishSpec()` | `render-spec.ts:1170-1183` |
| Patterns (spots, speckle, stripes, patches)                                    | `patternPrimitives()`       | `render-spec.ts:695-954`   |
| Shimmer (silver / bluePurple / iridescent)                                     | `shimmerPrimitive()`        | `render-spec.ts:970-1029`  |
| Volume shading (top-down ramp, bloom, shadow, gloss band)                      | inline in `buildFishSpec()` | `render-spec.ts:1204-1290` |
| Gill cover plate                                                               | inline in `buildFishSpec()` | `render-spec.ts:1294-1311` |
| Body outline stroke + rim light                                                | inline in `buildFishSpec()` | `render-spec.ts:1313-1346` |
| Mouth                                                                          | inline in `buildFishSpec()` | `render-spec.ts:1369-1386` |
| Eye                                                                            | inline in `buildFishSpec()` | `render-spec.ts:1388-1416` |
| Rarity finish (gloss/bloom/rim/fin translucency strength per tier)             | `MATERIAL_BY_TIER`          | `render-spec.ts:318-354`   |
| Legendary-exclusive sparkle accent (a shape, not just a scaled finish)         | `sparklePrimitives()`       | `render-spec.ts:911-963`   |
| Egg stage art                                                                  | `eggSpec()`                 | `render-spec.ts:206-224`   |

Line numbers are as of the current file; re-check them if the file has moved on since — they will drift as the file is edited.

## Key mechanics to know before editing

- **Local coordinate space**: origin at body center, nose points **left** (−x), y is **down**. Adult footprint is roughly x `[-61..70]`, y `[-46..46]` per the header comment.
- **Landmark-driven geometry**: `bodyGeom()` returns named points (`nose`, `backPeak`, `bellyLow`, `peduncleTop/Bottom`) that every fin function reads off of — e.g. `tailGeom()` anchors to `peduncleTop`/`peduncleBottom`, `dorsalGeom()` anchors to `backPeak.y`. Change a body landmark and every fin repositions with it.
- **Fins are built with two primitives**: hand-written Bézier `d` strings (body, tail-lyretail, dorsal) or the generic `fan()` helper (tail-round, pelvic, anal, pectoral) which takes a pivot/radius/sweep-angle/lobe-count and produces a scalloped fan + ray lines automatically.
- **Rarity jitter**: `material.finJitter` (from `MATERIAL_BY_TIER`) feeds into `fan()`/`jitterPt()` to make common-tier fins look organically uneven and legendary-tier fins look clean — don't hardcode jitter into geometry, pass it through.

## Configuring fish colors

Colors are split across two files — edit the right one depending on what you're changing:

| What you want to change                                                                        | File                                     | Lines                                   |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------- | ---------------------------------------- |
| An existing variety's actual hues (back/mid/belly/fin/finRay gradient stops, pattern colors, accent chip color) | [catalog.ts](../shared/fish/catalog.ts) `COLOR_DEFS` | one object per variety, `catalog.ts:9-270` |
| Add a brand-new color variety                                                                    | `ColorId` union in [types.ts](../shared/fish/types.ts), then a new `COLOR_DEFS` entry in `catalog.ts` | `types.ts:9-24`, `catalog.ts:9-270` |
| How the `palette` is turned into the body gradient (back→mid→belly)                              | `buildFishSpec()` in `render-spec.ts`     | `render-spec.ts:1170-1183`               |
| How `palette.fin`/`finRay` are turned into fin membrane + ray-line paints                        | `finPaint()` in `render-spec.ts`          | `render-spec.ts:1001-1029`               |
| Outline / rim-light color (derived from `palette.back`, not stored separately)                   | `outlineColor` in `buildFishSpec()`       | `render-spec.ts:993`, used at `render-spec.ts:1220,1231` |
| Pattern colors (spots/speckle/stripes/patches fill) — drawing logic, not the hex values           | `patternPrimitives()` in `render-spec.ts` | `render-spec.ts:583-954`                 |
| Shimmer tint (silver / bluePurple / iridescent) — a fixed overlay, not palette-driven             | `shimmerPrimitive()` in `render-spec.ts`  | `render-spec.ts:970-1029`                |

**For 95% of "make this fish a different color" requests**, you only need `catalog.ts`: find the variety's object in `COLOR_DEFS` and edit its `palette` (5 hex stops), `pattern.color`/`pattern.colors`, and `accentColor` (used for UI chips/badges, not the fish render itself). Each variety's `palette` is back→mid→belly for the body plus `fin`/`finRay` for the fins — see the shape at [types.ts:88-94](../shared/fish/types.ts).

Only touch `render-spec.ts` if you're changing *how* a palette gets turned into paint (e.g. the gradient shape, shading ramps, or pattern rendering) rather than swapping which hues a variety uses.

**`yarn fish:colors`** is a live editor for exactly this: it starts a local server (`scripts/fish-color-editor.ts`) and opens a browser UI with all 15 varieties in a sidebar, color pickers for palette/pattern/accent/shimmer, and a live preview of both body types (standard + balloon), re-rendered on every change via `buildFishSpec()` — the same function the app calls, through the shared SVG backend in `scripts/lib/fish-svg.ts` (also used by `fish:preview`, so the two tools can never drift from each other). Nothing is written to disk automatically: hit "Copy code" to get a `COLOR_DEFS`-shaped object to paste over the variety's entry in `catalog.ts`, then run prettier on the file.

After editing `catalog.ts` (by hand or via `fish:colors`), run `yarn fish:preview` and check the variety's row in `fish-preview.html` — it regenerates every color × life-stage combo from this exact data.

## Iteration loop (no device needed)

```sh
yarn fish:preview
```

regenerates [fish-preview.html](fish-preview.html) straight from `render-spec.ts` — open it in a browser after each edit to see every color × life-stage combo, plus dead/locked states. This is the fastest feedback loop; only fire up the simulator once you're happy with the shapes/colors there.

**One rule to keep**: `render-spec.ts` must stay free of React/React Native/Skia imports (it runs under plain Node for the preview script) — see `render-spec.ts:7`.
