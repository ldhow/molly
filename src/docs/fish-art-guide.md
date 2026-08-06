# Fish art editing guide

Practical map of [render-spec.ts](../shared/fish/render-spec.ts) for pure art changes — reshaping the body, tails, fins, or colors. Read the "How a fish is drawn" section of [CLAUDE.md](../../CLAUDE.md) first for the three-backend architecture this file assumes.

## Tools

[scripts/fish-path-editor.html](../../scripts/fish-path-editor.html) is a standalone visual editor for the fish's Bézier shapes — open it directly in a browser (no build/server needed). It lets you draw and drag body/fin outlines by hand, load the shapes currently shipping as a starting point, and export `d` path strings plus landmark/pivot objects formatted to paste straight into the functions below. It also renders a live composited preview of all parts together with a rough color fill, so you can sanity-check a shape without round-tripping through `yarn fish:preview`.

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

## Iteration loop (no device needed)

```sh
yarn fish:preview
```

regenerates [fish-preview.html](fish-preview.html) straight from `render-spec.ts` — open it in a browser after each edit to see every color × life-stage combo, plus dead/locked states. This is the fastest feedback loop; only fire up the simulator once you're happy with the shapes/colors there.

**One rule to keep**: `render-spec.ts` must stay free of React/React Native/Skia imports (it runs under plain Node for the preview script) — see `render-spec.ts:7`.
