# 3D tank design guide

Practical map of the 3D aquarium — reshaping the fish, retuning the water, planting the tank. This is the 3D counterpart to [fish-art-guide.md](fish-art-guide.md), which covers the 2D Skia fish.

The 2D and 3D renderers are **separate art pipelines that share one source of pigment**. Read the ["How a fish is drawn"](../../CLAUDE.md) section of CLAUDE.md first — several things here only make sense against it.

## Tools

**`yarn tank:design`** is the main one: a local server (default <http://127.0.0.1:5478>, override with `PORT=`) serving a live three.js scene built from the **same modules the app renders**, with a control for every tunable value grouped into panels down the left. Drag a slider, watch the tank change.

It opens in one of two **scene modes**, switched top-left:

- **Fish** (the default) is a rig — one fish parked at the origin, no decor, on a neutral mid-grey background with fog off, camera side-on to match the shape editor's own view. Fins keep beating so motion still reads, but nothing swims, bobs or turns. Use this for anything to do with the fish itself; rebuilds are much cheaper here too, which matters when every drag rebuilds geometry. Note the grey ground is a _rig_ choice for silhouette clarity (standard 3D-viewport grey — it won't blow out a pale belly or swallow a dark back the way white or black would) — judge colour and lighting in Tank mode, where the dark water is what the fish is actually seen against.
- **Tank** is the shipped scene. The **Speed** slider scales swim speed only — beat rate is normalised against the same base, so slowing the fish to a drift doesn't slow its tail to a crawl.

**The camera stays where you put it.** It only moves on a mode switch or an actual edit to the camera panel — never on the geometry rebuilds that fire while you drag a handle. Each mode remembers its own framing, so switching back and forth doesn't lose it. "Reset view" returns the current mode to its default viewpoint.

The **Fish shape** panel is a hand-built editor rather than sliders: a side view with a tab per part — Body, Tail, Dorsal, Pelvic, Anal, Pectoral, Eye. Body gives you the six named landmarks as draggable handles; each fin gives you a pivot handle (moves the whole fin) plus one handle per membrane tip, with `+ tip` / `×` to change the tip count. Whichever part is active is highlighted and grabbable while the rest stay drawn for context. `Ctrl`/`Cmd+Z` undoes. The outline is sampled from `fish-mesh-3d.ts`'s own curve function via `sampleBodyOutline()`, so what the editor draws is what the mesh sweeps — the one thing worth preserving if you touch this widget. Lateral X values, which a side view can't express, sit in number boxes beneath it.

Unlike `yarn fish:colors`, **this one writes to disk**: "Save to file" overwrites [tank-design.ts](../shared/components/tank/tank-design.ts) in place. That's safe because the file is pure generated-shape config — but it means anything hand-written you add there will be eaten on the next save. The type definitions and header comments above the `DEFAULT_TANK_DESIGN` literal _are_ preserved. After saving, run `npx prettier --write src/shared/components/tank/tank-design.ts` and `yarn verify:3d`.

"Copy JSON" / "Paste JSON" round-trip a whole design through the clipboard, which is how you keep a variant around or hand one to someone else. Nothing persists across a page reload otherwise.

| Also available           | What for                                                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `yarn verify:3d`         | Headless checks — geometry, pattern fidelity, bake-time budget, and the pinned fingerprints that catch accidental drift. Run after every change.                                |
| `yarn fish:3d-demo`      | Regenerates [fish-3d-demo.html](fish-3d-demo.html), a standalone browser scene needing no server. Good for a quick look or for sharing.                                         |
| `yarn fish:skin-preview` | Regenerates [fish-skin-preview.html](fish-skin-preview.html) — every variety's 3D skin texture next to its 2D reference. This is where you check _pattern_ fidelity, not shape. |

The client bundle is rebuilt on every page load, so editing source and refreshing the browser picks it up — no rebuild step.

## Where each part lives

Almost every value is in [tank-design.ts](../shared/components/tank/tank-design.ts); the table says which section, and which module consumes it if you need to change _how_ a value is used rather than what it is.

| What you want to change                    | Design section                                           | Consumed by                                         |
| ------------------------------------------ | -------------------------------------------------------- | --------------------------------------------------- |
| Body silhouette (six named landmarks)      | `fish.shape.landmarks`                                   | `fish-mesh-3d.ts` `createFishMesh()`                |
| How flat / full-bodied the fish is         | `fish.shape.maxHalfWidth`, `widthFalloff`                | same                                                |
| Slab-sided vs round in cross-section       | `fish.shape.crossSectionExponent`                        | same                                                |
| Body smoothness vs triangle count          | `fish.shape.spineStations`, `ringSegments`               | same                                                |
| Any of the five fins                       | `fish.shape.fins.<tail\|dorsal\|pelvic\|anal\|pectoral>` | `buildFin()`                                        |
| Eye size, position, colour                 | `fish.shape.eye`                                         | `createFishMesh()`                                  |
| Body gloss / metallic sheen                | `fish.material.body`                                     | same                                                |
| Fin translucency                           | `fish.material.fin`                                      | `makeFanFin()`                                      |
| Tail beat, pectoral sculling, bob, banking | `fish.motion`                                            | `update()`, `bankFor()`, `bobFor()`                 |
| Body undulation strength                   | `fish.motion.waveMultiplier`                             | see the trap below                                  |
| Dead-fish greying                          | `fish.dead`                                              | `desaturatePalette()`                               |
| Camera angle and lens                      | `scene.camera`                                           | `tank-canvas-3d.tsx`, `fish-3d-driver.ts`           |
| Water colour and murk                      | `scene.fog`, `scene.background`                          | `tank-canvas-3d.tsx`                                |
| Lighting rig                               | `scene.lights`                                           | same                                                |
| How much of the screen fish roam           | `scene.framing`                                          | `TankScene` in `tank-canvas-3d.tsx`                 |
| Distant water gradient                     | `water.backdrop`                                         | `tank-env-3d.ts` `createBackdrop()`                 |
| Sand colour, grain, dunes                  | `water.sand`                                             | `createSand()`, `createSandTexture()`               |
| Caustic web shape and drift                | `water.caustics`                                         | `createCausticsTexture()`, `createSand()`           |
| Floating particulate                       | `water.particles`                                        | `createParticles()`                                 |
| Leaf silhouette and midrib                 | `decor.leaf`                                             | `tank-decor-3d.ts` `getLeafTexture()`               |
| Plant species (colours, sizes, sway)       | `decor.species`                                          | `createPlants()`                                    |
| Plant placement and sway motion            | `decor.plants`                                           | same                                                |
| Bubbles / rocks / driftwood                | `decor.bubbles`, `decor.rocks`, `decor.driftwood`        | their `create*` functions                           |
| Sand height (everything sits on it)        | `decor.groundY`                                          | all of the above                                    |
| Pattern texture resolution                 | `skinPxPerUnit`, `skinSupersample`                       | `skin-map.ts` — **costs JS-thread time, see below** |

**The fish's colours and patterns are not here.** Those come from the 2D art pipeline — edit `COLOR_DEFS` in [catalog.ts](../shared/fish/catalog.ts) or use `yarn fish:colors`, exactly as described in [fish-art-guide.md](fish-art-guide.md). 3D rasterizes that same artwork into a texture, so a colour change shows up in both renderers at once.

## Key mechanics before editing

- **Mesh space**: Y is up, the nose points at **−Z**, and the body spans `-1..+1` along Z. The sand sits at `decor.groundY` (−1.8). This is a _different_ space from the 2D art's (nose at −x, y **down**) — don't carry coordinates between them.
- **The body is a swept cross-section, not a lathe.** A top curve runs `nose → backPeak → peduncleTop → tailBase` and a bottom curve runs `nose → bellyLow → peduncleBottom → tailBase`, independently; a superellipse ring is swept along the spine between them, its half-width derived from the local half-height via `maxHalfWidth` and `widthFalloff`. The independence is the whole point — the lathe this replaced revolved a single radius, so it was forced to be vertically symmetric and could never give a molly a deeper belly than back. Trait shapes (balloon, lyretail, sailfin) are still not reflected in 3D.
- **Landmarks are interpolated monotonically** (Fritsch–Carlson), not with an ordinary spline, so `backPeak` really is the highest point on the back instead of a value the curve overshoots on the way past. `verify:3d` asserts it.
- **`yawOffset` is coupled to the body's authored facing.** It's what makes the model's forward axis match the swim heading. If you ever re-author the body pointing a different way, this has to move with it.
- **Fins are one uniform structure.** Each of the five is `{ pivot, tips[], mirrored }` — the pivot is absolute mesh coordinates, tips are relative to it, and `mirrored` builds the opposite flank. So moving a pivot carries its membrane, tips reshape it in place, and adding a sixth fin needs no code change. Every fin also slides sideways with the body wave at its own station, or it visibly detaches from the flank.
- **The skin texture is a planar side projection**, not a ring-wrapped UV — `u` from Z, `v` from world Y. That's what makes the 2D artwork line up on the flank, and it mirrors across both sides for free.
- **Two tiers of edit.** Materials, lights, fog and motion mutate live. Geometry, textures, counts and seeds need a rebuild, which the editor debounces (~130 ms). The panel tells you which tier you're in.

### Three traps worth knowing

- **`fish.motion.waveMultiplier` is 3D-only on purpose.** The wave itself (`waveDy` in [swim-model.ts](../shared/lib/swim-model.ts)) is shared with the 2D Skia renderer and is a `"worklet"`. Editing it would silently reshape the 2D fish too — so the 3D gain is layered on top instead. There's also a `verify:3d` assertion guarding the px→world conversion, because getting it wrong once made the fish deform by whole body-lengths.
- **The leaf texture is memoised globally.** Changes to `decor.leaf.*` do nothing until `resetLeafTexture()` runs. The editor calls it on every rebuild; if you're driving the modules yourself, you have to.
- **`skinPxPerUnit` buys sharpness with frame time.** Pattern textures are rasterized on the JS thread, one per frame (see the queue in `fish-skin-texture.ts`). Raising it makes fish crisper and mounting slower — `verify:3d` has a bake-time budget that will tell you when you've gone too far.

## Iteration loop (no device needed)

```sh
yarn tank:design      # design it
yarn verify:3d        # prove nothing broke
yarn fish:3d-demo     # optional: standalone page to share or double-check
```

`verify:3d` pins several fingerprints (body bounding box, vertex counts, plant blade count, texture byte hashes). **A deliberate design change will fail those on purpose** — that's the point. Update the expected value in the same commit so the visual change is visible in review rather than silent.

Only build for a device once you're happy here. Note that `expo-gl` is a native module: if the installed binary predates it, an `eas update` won't show any of this — that needs one real `eas build`.

## One rule to keep

[tank-design.ts](../shared/components/tank/tank-design.ts), [fish-mesh-3d.ts](../shared/components/tank/fish-mesh-3d.ts), [tank-decor-3d.ts](../shared/components/tank/tank-decor-3d.ts) and [tank-env-3d.ts](../shared/components/tank/tank-env-3d.ts) must stay free of React, React Native and Skia imports. They're bundled for the browser tool and imported by Node verification scripts; a stray `react-native` import breaks both at once. Anything React-bound belongs in `tank-canvas-3d.tsx` or `fish-3d.tsx`.
