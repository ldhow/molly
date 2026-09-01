# The 2D renderer — how it works

The tank's 2D renderer, living entirely under
[`src/shared/aquarium/`](../shared/aquarium/) — official as of the legacy
renderer's removal, selectable via the render-mode toggle on the Tank screen
(labelled **2D**) alongside the 3D renderer. Read this before changing
anything under `src/shared/aquarium/` — it's the equivalent of
`fish-art-guide.md` / `tank-3d-guide.md` for this tree.

## Why this renderer looks the way it does

The legacy renderer this replaced drew a fish as three separately-baked
layers (body, tail, pectoral) with a rigid tail rotation and a body ripple
that shears cross-sections sideways instead of bending them. This renderer
instead bakes body + fins (each its own translucent shape, `fish/fins.ts`)
into ONE texture and animates the whole thing with a rigid spine bend, so the
whole animal moves as one piece even though the silhouette isn't a single
outline anymore — the "one organism bends together" property comes from the
shared warp on one baked texture, not from the outline itself being one path.

The whole thing lives in one directory, deliberately self-contained:

```
src/shared/aquarium/
  core/       IR, the one Skia emitter, the bake cache, SkSL shaders
  fish/       anatomy (original silhouette), fins, pigment/patterns, spine warp math
  scene/      planted-aquarium generators, composition, themes
  sim/        steering (x,z,y swim model) + per-fish personality
  render/     React/Skia components — the only public surface
```

It imports **only**: `@/shared/fish/{types,catalog}` (trait/colour data,
read-only) and generic shared libs (`@/shared/lib/*`,
`@/shared/constants/tank.ts`). Not `@/shared/fish/render-spec.ts` — that
module still exists but is now 3D-only (its skin-texture bake), so this tree
keeps its own `render/dead-fish.ts` copy of the dead-fish constants instead
of reaching into it. Not `@/shared/hooks/use-fish-swim.ts` either — that hook
was the legacy renderer's steering and is now 3D-only; this tree owns its own
(`sim/swim.ts`), see **Behaviour** below. See
[`aquarium/README.md`](../shared/aquarium/README.md) for the full import
allowlist.

## How a fish is built

Four stages, each a separate module:

1. **Anatomy** (`fish/body-profile.ts` for the body curve tables,
   `fish/profile.ts` for the PCHIP math, `fish/fins.ts` for fins,
   `fish/anatomy.ts` gluing them together) — a BODY-ONLY closed outline (a
   monotone-cubic/PCHIP half-height curve, top and bottom independently)
   from **hand-authored control points in `body-profile.ts`** — an original
   silhouette, not derived from the legacy 2D renderer's shape (an earlier
   version fit the curve to the legacy renderer's exact body path via a
   now-deleted `legacy-fit.ts`; see **Art direction** below for why and how
   that changed) — plus **separate translucent fin shapes** from one
   generic fan builder in `fins.ts` (`FinSpec` → hub + margin + rays,
   per-trait tables for dorsal/anal/pelvic ×2/pectoral ×2/caudal). An
   earlier version of this fused fins into the body outline as raised-cosine
   "bumps" — that reads as a lumpy potato with no fin/body separation and no
   real peduncle; fins as their own shapes, drawn root-opaque-to-tip-
   translucent and buried under the body's own skin fill (the "buried root"
   draw order — see `bake-fish.ts`), is what actually reads as a fish.
   Extending anatomy (a new tail, a new dorsal) means one entry in
   `body-profile.ts`'s tables (body) or `fins.ts`'s `FinSpec` tables (fins).

2. **Pigment** (`fish/pigment.ts` for the generators, `fish/pattern-defs.ts`
   for this renderer's own pattern vocabulary) — palette gradient, pattern
   generators, shimmer, scales, rarity material. Every generator places
   shapes purely in terms of `PigmentGeom`'s landmarks and body curves
   (`topAt`/`bottomAt`) — never a literal legacy-frame coordinate — so a
   body re-sculpt doesn't strand any of them; this was tightened during the
   original-silhouette rework, since four of the "already relative"
   generators (`stripes`, `patches`, `speckle`, `shimmerPrimitive`) turned
   out to still carry hardcoded absolute numbers left over from the legacy
   frame. The clip is the same body-only outline `outlineD` — patterns land
   on the trunk and stop at the fin roots.

3. **Spec + bake** (`fish/bake-fish.ts`) — composes body + fins + pigment into
   one IR tree and bakes it to a single texture (`core/bake.ts`) — one layer,
   not the old pipeline's three, since the tail no longer animates as a
   separate piece. Draw order is the "buried root" trick: far pectoral → far
   pelvic → caudal → dorsal → anal + near pelvic → the OPAQUE body skin group
   (which buries every fin root's seam) → gill/contour/rim/shimmer → near
   pectoral → face. `fin/hub` placement is verified strictly inside the body
   by each fin's `sink` value and every fin's median tip strictly outside it
   — see `scripts/verify-aquarium.ts`'s anatomy invariants. Face features
   (eye, mouth, gill cover) anchor to `u`-fractions of the head
   (`xAt(u)`, `topAt(u)`/`botAt(u)`) rather than absolute pixel offsets from
   the nose plane, so a future snout re-sculpt moves them automatically
   instead of needing another by-eye re-tune; the gill patch additionally
   scales with `landmarks.halfHeight` so it doesn't look undersized on a
   deeper head (balloon).

### Art direction

The body is a genuinely original design, not the legacy renderer's "chunky
realistic molly" resized — a plump, storybook-cozy companion fish.

**Surface treatment is a lit animal, NOT a drawn mascot.** This reverses the
earlier "bold illustrated mascot" pass. That pass had made every surface cue
an authored graphic — a hard ink outline, an opaque body-coloured tail, a
white plastic highlight — and the result read as a sticker. The diagnosis
that drove the reversal was a single root cause: **every colour move in the
renderer ran along the value axis only.** `shared/lib/color.ts`'s
`darken`/`lighten` are `mix(hex, black)` / `mix(hex, white)`, the body ramp
was one hue at three lightnesses (gold: `#bf7c10`/`#eda426`/`#f8cd63`, hue
≈ 40 throughout), and all five creatures built their tones the same way. A
real surface shifts **hue and saturation** as it turns away from the light;
a pure value ramp is what "plastic" looks like.

[core/shading.ts](../shared/aquarium/core/shading.ts) is the one place light
and tone now live, so the fish and the five creatures cannot drift apart. Its
header carries the per-decision rationale; the short version:

- The contour is a **form edge, not an ink line** — `BODY_KEYLINE`, 1.35px at
  `0.34` alpha with real blur, in `keylineColor()`'s hue-rotated tone rather
  than `darken(back, 0.45)`. The mascot pass had this at 2.1px / `0.88` /
  blur 0.15, which made the molly the only animal in the tank wearing an ink
  outline (the five creatures were already at 0.6–1.4px). Fin keylines drop
  further, to `0.2`/`1.2px`: a heavy line around a see-through fin re-creates
  exactly the solid-paddle read the translucency exists to remove.
- **Counter-shading is a hue and saturation move, not only a value one.**
  `countershadeStops()` lays 6 stops weighted to where a real fish's
  transitions are — dorsal darkening in the top ~16%, ventral whitening in
  the bottom ~18%, saturated flank owning the middle. `MAX_DORSAL_DROP` is
  the identity guard: shading may deepen a variety's authored `back`, never
  replace it. An earlier version scaled dorsal lightness by a flat factor and
  turned goldDust — a _gold_ fish — into a uniformly dark one.
  `SHADOW_HUE` is **violet, not blue**, and that is not cosmetic: rotating a
  warm hue toward blue-220 takes the short arc through green, and every warm
  variety's dorsal came out olive.
- **The body does not stop at the peduncle.** Four separate mechanisms
  keep body and tail reading as one animal, and all three are needed:
  `silhouetteStrokeD` walks the contour around the caudal's own rim instead
  of across the peduncle; `buildCaudalFillD` closes the fin's fill on the
  exact plane the body's fill ends; and `caudalRootBlend` carries the body's
  **vertical** counter-shading ramp a short way into the tail. That last one
  is what the first two could not fix: the body is graded top-to-bottom at
  the peduncle while the caudal's pivot→tip gradient is flat there, so the
  two surfaces mismatched at _every_ height and read as glued-together pieces
  no matter how well their average tones agreed. It became obvious once fin
  translucency landed. **Reach is the whole balance** — `0.12` of the tail
  with a matching mask blur. A first attempt at `0.4` removed the seam by
  painting goldDust's near-black caudal gold and zebra's white, i.e. by
  deleting the fin's own colour. This models a fleshy peduncle stub; past it
  the membrane is the membrane.

  The fourth is the **rim light**, which also strokes and clips
  `silhouetteStrokeD` now. It was still on `outlineD` long after the ink
  keyline had been corrected — so it stroked the straight peduncle end-cap,
  and since `rimTo` sits toward the rear/shadow side the gradient peaks
  exactly there. That painted a bright vertical bar rising from the belly
  line straight across the tail joint: the "white line from belly to tail"
  that kept the tail reading as a bolted-on piece. **If a node strokes the
  body, it must stroke `silhouetteStrokeD`** — `outlineD` exists to close
  the FILL polygon and its cap edge is not a real edge of the animal.

- **Fins are membranes** (`FIN_MEMBRANE`). The root stays nearly opaque —
  a real fin base _is_ thick where it sockets into the flank — and the
  fall-off does the work. Hue is deliberately untouched: an attempt to mix
  fin stops toward one water tint greyed out goldDust's black fins, sanke's
  pink caudal and electricBlue's blue ones at a stroke. `TIP_FLOOR` and
  `RAY_BOOST` are legibility, not taste — tank mode draws at
  `AQUARIUM_FISH_SCALE = 0.6` against decor, and at that size the rays are
  what keep a translucent fin readable.
- **Fin membranes are anchored where the fin EMERGES**, not at the hub.
  `FinShape.sink` exists for this: every sunk fin (dorsal 7, anal 8/6,
  pelvic 4) had its gradient anchored at `pivot`, which is inside the body,
  so the dark opaque root stop landed under the skin fill and the visible fin
  got only the flat tail of the ramp. The dorsal on the pale varieties looked
  like a lobe floating above the back. `emergence()` walks `sink` units
  along the hub→tip axis so the visible part gets the whole dark-root →
  translucent-tip fall-off the membrane design always intended.
- **The operculum is a MARGIN, not a patch.** It used to fill the whole
  hand-authored leaf with flat `#ffffff` at 0.16 — a large relative lift on
  a dark variety, so black and goldDust wore a hard-edged pale slab across
  the cheek. On a real fish the plate is the same skin as the cheek; what you
  see is its rear margin. Now there is no flat fill, and the fold is drawn as
  **two** passes: a crease in the keyline tone, and a light catch just
  forward of it. Both are needed — the crease is black-on-black on `black`
  and vanishes, while on pale varieties the light catch is the one that
  disappears. A real fold has a shadow on one side and a lit edge on the
  other anyway.
- **Scales stop before the head** (`scaleVisibility`'s `u` term). A fish has
  no body scales on its snout or operculum; rows used to run straight over
  the face.
- **The mouth is terminal and fades out.** Two parallel hard strokes read as
  a dash with a second dash floating above it; it is now one shorter line
  in the keyline tone taken to zero at its rear end, plus a lip catch
  confined to the front half.
- **Highlights are cool, not white.** `SPECULAR_TINT` / `RIM_TINT` replace
  literal `rgba(255,255,255,·)` everywhere, fish and creatures alike. The key
  light has already been filtered by the water column before it reaches
  anything; a pure-white specular over warm skin is the clearest plastic cue
  there is. The rim is cooler than the specular — it has wrapped through more
  water.
- The shading stack itself is still **few, high-contrast layers**, not many
  soft ones: the counter-shading ramp, one tight rear/belly AO, and one
  compact specular (a `scale.x = 2.2` ellipse at low blur) plus its hotspot.
  The pre-mascot stack — 7-stop ramp + softLight bloom + multiply shadow +
  a full-width blur-6 gloss stripe — averaged out to flat mid-tone at real
  viewing size, and that part of the mascot pass was right.
- There is **no blush**. The pink cheek decal had already been dialled down
  once; it was the one element on the fish with no physical referent, so the
  naturalism pass removed it rather than dialling it a third time.
- **The eye has no white.** `fish/eyes.ts` was drawing a mammal's eye — a big
  white sclera ring around a small dark pupil — which is a cartoon
  convention, not an animal one, and it was the single loudest fake cue left
  on the fish. A fish's eye is an **iris filling nearly the whole opening**
  (metallic, brightest toward its rim, with a dark limbal ring) around a
  **wide, deep pupil**, all under a wet cornea. `eyeBase()` builds exactly
  that and all five styles (`classic`/`ringed`/`almond`/`deep`/`hooded`, one
  per individual from its own `patternSeed`) are proportions on top of it.
  Contrast did not drop: the read is now bright metallic iris against
  near-black pupil instead of white against black, which is _more_ legible at
  `AQUARIUM_FISH_SCALE`. Three things to not undo:
  - `irisTone()` pulls a too-dark palette colour toward **`IRIS_METAL`
    (gold), not toward white.** Mixing toward white is what the first attempt
    did, and it turned goldDust's near-black `#20222b` fin into a pale grey
    band — a white sclera by another name.
  - The cornea sheen is **weak and confined to the light-facing quadrant**
    (0.2 over 0.95r). A first pass at 0.32 over 1.45r greyed the pupil out
    entirely; the eye stopped having a dark centre, which costs far more than
    the wetness gained.
  - The `hooded` lid bottoms out at **0.5r above centre**, not at the centre
    line. Reaching the centre leaves a crescent of iris under a huge lid and
    reads as a _wink_ — very obvious on light-irised varieties like sanke.

  Eye **radius is an authored constant**, never derived from `halfHeight` —
  the same call `anatomy.ts` makes for fins via `FIN_REF_HALF_HEIGHT`; only
  the eye's position tracks the body.

- Scales (vảy cá) are real surface texture, but a **light response**, not a
  decal. `scaleVisibility(v)` fades each plate by its height on the body:
  strongest on the upper flank under the specular, near-invisible on the
  belly, where a real fish is smooth silver. Placement was always correct;
  painting all ~300 arcs at one flat opacity is what turned good geometry
  into patterned wallpaper. `pigment.ts`'s
  `scalePrimitives` lays plates out in body-relative `(u, v)` — reading
  `topAt`/`bottomAt` so rows bow with the belly, converge at the peduncle,
  and shrink with local body depth toward head and tail. It used to grid the
  trunk's **bounding box**, which gave straight rows of identically-sized
  scales: a rectangular texture on a non-rectangular animal. Each plate is
  drawn twice (a dark free margin plus a lighter arc lifted just inside it);
  the pair is what reads as overlap, and one arc alone reads as dashes. The
  whole set returns as **one clipped group** — `emit.ts` does a
  save/clipPath/restore per node carrying `clip`, and there are ~300 arcs.

Per-variety palettes are untouched by every one of these passes and stay
authentic: Gold Dust really does have a black head and dark fins, Sanke its
red/black koi blocks. Don't recolour the catalog toward one reference image —
the style is shared, the colours are each variety's identity. The naturalism
pass reshapes how `back`/`mid`/`belly`/`fin` are LAID DOWN and never what they
are, and `verify-aquarium.ts`'s §10e-2 block enforces that: it runs the real
`countershadeStops` over every breed and fails if the rendered dorsal drifts
more than 0.17 below the authored `back`, or if the ramp stops desaturating
toward the belly.

Measurement convention:
`aspect = length(nose→peduncle) / max(top(u)+bottom(u))` — legacy standard
measures 2.48:1 under this convention; this renderer's `standard` targets
~1.97:1 (stubbier, rounder) and `balloon` ~1.29:1 (short, egg-round), both
checked by `verify-aquarium.ts`'s body-proportion assertions. The back
crests forward of centre (a "shoulders up" read), the belly peaks just past
centre, and the peduncle sits genuinely **on-axis** (legacy's rides high,
`peduncleMidY ≈ -4.85`; here `≈ -0.7`) — a real proportional break from the
old design, not just a resize. Fins dial `bulge` up / `scallop` down from a
realistic fish's proportions for rounder, less spiky-comb margins.

**The spine-warp injectivity budget is the hard constraint that shapes every
number here** (`spine.ts`'s fold-safety ceiling, `verify-aquarium.ts`'s
`INJECTIVITY_BUDGET_MAX = 0.65`): it scales roughly with `nMax / bakeBoundsWidth²`,
so a shorter, deeper body — exactly what "stubbier" means — pushes it hard.
A naive 1:1 balloon computes to ~0.78, an outright failure. The levers, in
order: a fuller/longer caudal fan (protects bake-bounds width, and is the
right storybook look on a stubby body besides), `SPINE_PAD` (raised 18→22
for the deeper balloon body), and only as a last resort a per-body
`FIN_SCALE_BY_BODY` multiplier in `anatomy.ts` — never the budget ceiling
itself. Re-measure via `verify-aquarium.ts` before changing proportions
again; don't guess.

4. **Swim bend** (`fish/spine.ts` + `core/sksl/warp.ts`) — a rigid
   normal-offset warp of the whole baked texture: `d(x) = A(u)·sin(phase −
K·u)` with a tail-weighted amplitude envelope, offsetting each point along
   the curve's NORMAL (not straight down), so cross-sections stay rigid and
   the silhouette bends with the fill. `spine.ts` is the reference
   implementation (pure TS, forward + inverse); `core/sksl/warp.ts`
   re-derives the identical formula in SkSL. They're written out twice on
   purpose — a shared template can compile and still be wrong in a way
   neither language's typechecker catches — and
   `scripts/verify-aquarium.ts` renders a sampled grid through both and
   asserts sub-pixel agreement.

   `render/fish-layer.tsx` draws this as `<Rect><Shader
source={warpEffect}><ImageShader .../></Shader></Rect>`, degrading to a
   plain rigid `<Image>` if the shader fails to compile (shouldn't happen,
   but mirrors `fish-picture.ts`'s `FISH_RENDER_MODE` degradation contract).
   Dead fish never animate — they always use the rigid path.

   Edge-on (see **Behaviour** — the fish turns through depth, not by
   flipping), the warp's local-y displacement would read as a thin sliver
   waving up/down instead of a tail sweeping side to side: `fish-layer.tsx`
   damps `ampScale` by `lerp(0.35, 1, |cos yaw|)` there and pays the lost
   motion back as a whole-sprite horizontal wobble, so a broadside fish body-
   bends and an edge-on one shimmies instead — the two cross-fade with
   `|sin yaw|`.

## Creatures — the other 5 species

This tree is also the ONLY renderer that draws non-molly species (otter,
turtle, frog, axolotl, snail) — 3D only ever sees the molly individuals in a
tank (`tank-view.tsx` filters the rest out before handing `MollyTankFish[]`
to it). See `@/shared/lib/tank-fish.ts`'s header for the
`MollyTankFish`/`CreatureTankFish` discriminated-union trick that makes that
filter free (a `MollyTankFish[]` is structurally assignable wherever
`AnyTankFish[]` is expected).

**Module pattern**, one directory per species under `creatures/<species>/`:

```
creatures/<species>/
  anatomy.ts        // silhouette + landmark points, whatever shape fits this body plan
  limbs.ts           // legs/gills as their own geometry, when the species has any
  pigment.ts          // this species' own small variant -> palette mapping
  bake-creature.ts    // composes anatomy + pigment, draw order, bakes to one texture
```

`creatures/bake-creature.ts` (no species subfolder) is the ONE dispatcher —
`render/creature-cache.ts` calls only `bakeCreature(Skia, speciesId, variant,
dpr)`/`creatureBakeKey(...)`, never a per-species module directly, so
shipping a species' real anatomy is a one-line `case` added to that
dispatcher's `switch`, nothing else. A species with no `case` yet falls
through to `creatures/bake-placeholder.ts` — a simple proportioned blob at
the right palette/size, not a crash — which is how all 5 species shipped
end-to-end (economy, picker, Fishdex, stats, cross-renderer fallback) before
any of them had real anatomy.

**Lighting IS shared, even though anatomy isn't.** Every species'
`*SkinPaint()` builds the same `{top, mid, bottom, outline}` shape, and all
five now build it from `core/shading.ts`'s `warmLight`/`coolShadow` rather
than `lighten`/`darken` — same `t` values, hue-aware output. Their single
`blend: "screen"` gloss lobe uses `SPECULAR_TINT` for the same reason the
fish's does. Two things to NOT "fix":

- These ramps are **top-lit, not counter-shaded**, and that is correct: fur
  and a shell are lit from above, and only a fish has a genuinely
  counter-shaded belly. The otter's pale belly is a separate radial patch in
  its `bake-creature.ts`, which is the right way to express it.
- The **snail's foot ramp is inverted** (`top: coolShadow`,
  `bottom: warmLight`) relative to every other one in the tree. A sole is lit
  by bounce off the substrate below it. Leave it inverted.

**Anatomy is NOT the fish model reused.** `fish/pigment.ts`'s `PigmentGeom`
contract (`topAt`/`bottomAt`, a single-valued top/bottom half-height curve)
is fish-shaped on purpose and stays fish-only — a snail's coiled shell or a
turtle's domed carapace aren't expressible as one. What's actually generic
lives in `core/pigment-toolkit.ts` (rng seeding, `blobPath` for small
decorative blobs — patches, scutes, spots — and `ribbonAlongPath`, a ribbon
traced along an arbitrary parametric centerline) and `core/limb-chain.ts`
(`circleChain` — a tapered chain of overlapping circles for jointed or
stalk-like limbs: frog's bent legs, axolotl's gill fronds and stub legs,
otter's short legs). Two lessons worth knowing before adding a sixth
species:

- `blobPath` is for SMALL decorative shapes, not a whole-body silhouette —
  its 7-point construction has a real seam/corner at its start angle,
  invisible on a tiny patch but a visible flaw on a large body outline (this
  cost a debugging pass on frog's body before landing on a plain two-arc
  ellipse instead). A whole body/shell outline wants `pchip` (elongated,
  fish-style — snail's shell, axolotl's and otter's bodies) or a plain
  ellipse (round bodies — frog, turtle's shell), not `blobPath`.
- `circleChain` (a chain of overlapping filled circles) beats a hand-rolled
  tangent-line capsule outline for any tapered limb — two overlapping
  circles can't self-intersect or produce a stray spike the way bitangent
  math can get subtly wrong at certain radius/length ratios (this also cost
  a debugging pass, on frog's original leg geometry).

**Locomotion.** Three kinds, and they are not three settings on one engine —
`crawl` is a different engine (see the next section). The swimming two:
every species is `rigid` (swim-transformed but not body-bent) except
axolotl, the one `undulating` species — it's the only
non-molly body that spine-warps, sharing `fish/spine.ts`'s tuned amplitude/
wavenumber constants and `core/sksl/warp.ts`'s shader (both operate on a
baked texture's bounds generically; nothing about the warp itself is
fish-shaped). `render/creature-layer.tsx` is `fish-layer.tsx`'s non-molly
counterpart: same swim engine and perspective-matrix transform (a
DELIBERATE, documented duplication rather than a shared import, so this file
can never regress the fish renderer's own verified tuning), but branches on
`getSpeciesDef(speciesId).locomotion` to pick the plain `<Image>` path or the
same `WarpedBody`-style shader path `fish-layer.tsx` uses. It is a
dispatcher over three sibling COMPONENTS (`SwimmingCreature`,
`CrawlingCreature`, `DeadCreature`) rather than three branches in one, since
each owns a different set of hooks; `speciesId` and `status` are fixed for
the life of a `key`, so no mount ever flips between them mid-animation.

### The snail doesn't swim — `sim/crawl.ts`

A snail is not a slow fish. It has no swim bladder and no fins; it glides on
its foot, and the only places it can be are the substrate, the glass, and
whatever is rooted in the tank. Steering it with `sim/swim.ts`'s free
(x, z, y) particle produced a snail hovering in open water — the one thing a
snail never does — and no amount of "steer it back down" tuning fixes a model
that can represent the wrong state in the first place.

So `locomotion: "crawl"` runs a different model: a **track** (an open
polyline of surfaces) plus a 1-D position along it. The snail cannot leave
the track — not "is pulled back from open water", but has no degree of
freedom pointing there — which is why `verify-aquarium.ts`'s crawl trace can
assert its contact point is on the track to within 0 px over 12 seeds x 90 s.

Three pieces, mirroring the swim engine's split:

- `sim/crawl.ts` — pure, worklet-safe. `buildCrawlTrack()` lays out the
  route (down the left glass -> chamfered corner -> substrate -> up and over
  ONE seeded decor stem -> substrate -> corner -> up the right glass);
  `stepCrawl()` advances arc length with a pedal-wave surge, alternates
  `glide`/`graze` spells, and bounces at the track's ends.
- `sim/use-crawl.ts` — the `use-v2-swim.ts` twin: one `useFrameCallback`,
  results out as SharedValues.
- `render/creature-layer.tsx`'s `CrawlingCreature` — places the art.

**The track's normal convention is load-bearing.** Walking the polyline in
increasing `s`, the tank's interior is always to the LEFT of the direction of
travel. That single rule is why placement is `translate(contact)` +
`rotate(tangent)` with no per-surface special case: the substrate, both panes
of glass, and both faces of a stem all fall out of it, and a snail crossing
over a stem's top correctly ends up on the far face. Reversing direction
flips the SPRITE (`dir`), never the normal — the snail is still stuck to the
same side of the same surface.

The art has to hold up its end of that contract, so `creatures/snail/
anatomy.ts` is authored in a frame where **the sole's contact line is y = 0,
+x is forward, and -y is away from the surface**. `verify-aquarium.ts`
asserts both halves (nothing below the sole line; the head forward of the
shell), because an art change that quietly moved the body off y = 0 would
show up as a snail sunk into the sand or floating off the glass, in the app
only.

**Climbable decor** is passed in, not discovered: `aquarium-canvas.tsx`
derives `ClimbProp[]` from the composed scene and hands each snail only the
pieces in **its own depth band**, because a snail is drawn inside that band's
`ParallaxGroup` — stems from another band would be offset by the parallax
delta and the snail would climb empty water beside the plant. Pieces shorter
than `CLIMBABLE_MIN_HEIGHT` (pebbles, carpet plants) are filtered out, and
the climb stops at 78% of a piece's height, since the top of a plant is
foliage rather than a perch.

**Two textures, not one.** The snail is the only species that bakes in
pieces (`part: "body" | "tentacles" | "full"`, threaded through
`creatureBakeKey`/`bakeCreature`/`getCachedCreature` as an optional argument
every other species ignores). A rigid texture sliding along a wall reads as a
sticker, and a crawler has no body-bend to carry motion of its own — so the
eye stalks bake separately and rotate about `TENTACLE_PIVOT`, which sits
inside the head dome so the roots stay buried under the body fill at every
sway angle (the same "buried root" rule fin roots use). `part: "full"` is the
whole snail in one texture, tentacles at rest — what every static surface
(Creaturedex, Holding Tank, the dead snail) draws, since those have no
animation to justify a second draw call.

**A dead crawler rests differently.** The generic dead treatment centres a
capsized creature's bounds on the sand; a crawler's art hangs entirely above
its own origin, so `DeadCreature` offsets by a full art height instead —
which lands the shell on the substrate with the foot up, exactly how a dead
snail is found.

**Shell geometry, one trap worth knowing.** A ribbon traced along 2+ turns of
a log spiral OVERLAPS ITSELF, and Skia fills by winding number: the overlaps
cancel and the shell renders as a translucent target you can see the body
through. The union of the tube is just its outermost whorl anyway, so
`buildShellD()` traces only the last turn's outer edge, closes it with a
rounded aperture lip, and lets `pigment.ts` draw the inner whorls as MARKS on
that fill (a seam line, and per-turn bands emitted innermost-first so each
whorl paints over the one it grew from). Bands run ALONG the coil, not
across it — a band drawn across the tube lands at the same polar angle on
every turn and the coil reads as a pie chart.

**Preview.** `render/creature-preview.tsx` bakes a `{speciesId, variant}`
through this same pipeline and renders it as a static, non-swimming
`<Image>` — every non-molly preview surface (the home-screen species picker,
the Fishdex, the Holding Tank tile) routes through it, since those species
have no legacy-renderer vector art to fall back to the way molly's `FishBody`
preview does.

**Verification.** `verify-aquarium.ts`'s "Creature bakes" section and
`aquarium-preview.ts`'s "Creatures" gallery section both iterate
`SPECIES_LIST` through the same `bakeCreature` dispatcher every render path
uses. The snail adds two of its own: verify's "Snail crawl" section (art
frame contract + a 12-seed x 90 s crawl trace) and the preview's "Snail — the
crawl track it is bound to" strip, which draws the same texture at 14 points
along a real track. Whether the foot actually meets the substrate, the glass
and both faces of a stem is only judgeable by looking, and that strip is
where you look — a species graduating from placeholder to real anatomy is covered by
both automatically, no script change needed.

## How the tank is composed

`scene/` is a small procedural-decor system, not a fixed set of decorations:

- `scene/gen/*.ts` — pure, seeded generators (`driftwood`, `anubias`,
  `vallisneria`, `stemBush`, `seiryuStone`, `substrateMound`, `pebbles`,
  `kelp`, `bloom`, `cabomba`, `sword`), each returning IR nodes + a bounding box + (for driftwood) mount
  **anchors** other pieces can attach to. `core/ir.ts`'s `GroupTransform`
  (translate/rotate/scale on a group) is what lets a leaf be authored
  pointing straight up and then placed at any angle — don't hand-rotate path
  coordinates, that's exactly the class of bug this exists to prevent.
  Driftwood also takes a `mirror` flag (`GeneratorArgs.mirror`): it flips the
  horizontal sign at every step of the trunk/branch random walk (same rng
  sequence, same organic wander, reflected), not the heading algebra — an
  earlier version's `trunkHeading` could only ever produce a rightward lean
  regardless of which side of the tank a piece sat on, so a "second,
  mirrored driftwood on the right" was structurally impossible until this
  existed.
- `scene/themes/nature-scape.ts` — the authored composition: WHERE each piece
  sits (`xFraction`), which layer it's in, and what it attaches to. Tuned by
  eye against real aquascaping composition rules (concave "U" layout, a
  focal point on a rule-of-thirds line, deliberate left/right asymmetry, and
  distinct fore/mid/background zones), not generated — the point of a theme
  is a human decided the composition, per `nature-scape.ts`'s own header
  comment.
- `scene/compose.ts` — resolves attachments, converts `xFraction` to actual
  pixels, and applies a size factor (`sizeFactorFor`) so the same theme
  doesn't flood a narrow portrait canvas with fixed-pixel-size decor. The
  factor is the min of a canvas-WIDTH-relative term and a canvas-HEIGHT-
  relative one, not width alone: on a short landscape canvas the water
  column height is the actual binding constraint (a driftwood trunk scaled
  for a tall portrait column has branches that reach much further
  horizontally from the same lean angle), and this measurably intruded into
  the swim lane at 844×390 before the height term was added. Real
  regressions here are caught by `verify-aquarium.ts`'s column-occupancy
  check (see below), not eyeballing.
- `render/scene-layers.tsx` + `render/decor-cache.ts` — bakes each piece once
  (same `core/bake.ts` LRU as fish) and draws it with a per-piece sway
  transform. Back-layer pieces render at reduced opacity (`LAYER_OPACITY` in
  `scene-layers.tsx`) as a cheap atmospheric-perspective depth cue — this is
  deliberately plain per-pixel opacity, not a blend-mode tint rect: an
  earlier version of this tried tinting via a `blend:"multiply"` rect and it
  painted a visible box over the WHOLE bounding rectangle, because multiply
  blend degenerates to plain alpha wherever the backdrop is transparent —
  `canvas.drawPath` paints its own shape regardless of blend mode, so a
  rectangle paints a rectangle no matter what.

Fish interleave with scenery in three depth bands (back/mid/front), so fish
genuinely draw behind mid-ground plants and in front of background ones —
see `aquarium-canvas.tsx`'s draw order and `bandOf()`.

`kelp` and `bloom` are the two newest generators and exist for composition,
not botany: **kelp** is a tall, broad, dark silhouette wall framing both tank
edges (back layer, so it can never crowd the swim corridor), and **bloom** is
a deliberately tiny pink/violet flower cluster that keeps an all-teal scene
from reading monochrome. Two sizing traps worth knowing, both hit during that
build: `compose.ts`'s `sizeFactorFor` clamps to **0.6** on a 390px-wide phone
(its reference width is 700), so decor authored to "reach the top of frame"
must be sized against the _post-clamp_ value or it lands at ~40% height; and
a kelp frond narrower than ~20px post-scale is indistinguishable from the
`vallisneria` grass in front of it, which defeats having a second species.

Note the spaciousness/corridor invariants in `verify-aquarium.ts` rasterize
**mid+front only** — back-layer decor like kelp is deliberately out of their
scope, since it draws behind the fish and cannot block them. Adding mass
there is safe; adding it to mid/front is what those checks police.

**Every background number lives in one place**, `scene/scene-design.ts` —
each species' shape/size/colour ranges (`DriftwoodDesign`, `KelpDesign`, ...),
plus water/substrate gradient stops, bubble count/size, and the back/mid/front
opacity + current-lean constants `scene-layers.tsx` reads. Before this existed
these were literals buried inside each `gen/*.ts` function body and a handful
of `render/*.tsx` consts, uneditable without changing code; every generator
and render file now imports its slice of `DEFAULT_SCENE_DESIGN` at module
scope, the same pattern `fish/body-profile.ts`/`fins.ts` already use.

`yarn aquarium:design`'s **Scene tab** (alongside the existing Shape and
Motion tabs — see `scripts/aquarium-design-editor.ts`'s header comment) is
the live editor for all of it: a slider/colour-picker panel per species plus
Water/Substrate/Bubbles/Layers sections, a real server-rendered preview (the
same `composeScene`/`bakeNodes` path `aquarium-preview.ts`'s full-scene
composite uses, so what you see is pixel-identical to what ships), and drag-
to-reposition on the preview itself for `nature-scape.ts`'s placements. Two
save models, matching the split the tool's header comment documents for
Shape vs Motion: species/water/substrate/bubbles/layers write `scene-
design.ts` directly (a pure config literal — safe to rewrite wholesale);
placements save only `xFraction`/`scale`/`mirror` in place inside `nature-
scape.ts` (`scripts/lib/placement-patch.ts`), since that file carries real
curatorial prose _between_ placement entries (the concave-U layout, rule-of-
thirds rationale) that a whole-array rewrite would destroy — adding/removing
a placement or changing its species/layer/attachment is Copy-code only, same
split the Shape tab uses for `body-profile.ts`/`fins.ts`. Run
`yarn verify:aquarium` after any Scene-tab save.

### Far layer, carpet, rotala

Two more species exist for composition, not botany, same spirit as kelp/bloom:
**carpet** (`gen/carpet.ts`) is a low ground-cover clump scatter kept under
`CarpetDesign.heightMax` on purpose so it never competes with the taller
front/mid pieces for the corridor/spaciousness invariants, and **rotala**
(`gen/plants.ts::generateRotala`) is a red-stem accent sharing `stemBush`'s
body via an extracted `generateStemPlant` helper, just a warmer palette and
its own rng stream. `SceneLayer` also gained a fourth value, `"far"` — dim
(`layers.opacityFar`), distant silhouette decor drawn behind `"back"`, no
fish band ever occupies it (`aquarium-canvas.tsx`'s `bandOf()` still only
returns back/mid/front), and exempt from the composition invariants exactly
like `"back"` (`verify-aquarium.ts`'s `midFront` filter is now an allowlist
of `"mid"`/`"front"`, not a `!== "back"` exclusion).

### Procedural backdrop fill — `scene/backdrop.ts`

The authored theme covers composition; it never covered _coverage_. All its
mass sat at the extreme left and right edges, so the whole middle of the frame
was bare water — `verify-aquarium.ts` measured mid+front decor at **3.1% of
the canvas** against its 45% ceiling, with 100% of columns classed as open
corridor. Against that emptiness the fish read as oversized.

`scene/backdrop.ts` fills it procedurally: jittered-stratified columns across
the full canvas width (bleeding slightly past both edges so the parallax drift
never exposes a seam), in passes — a `far` receding bank, a `back` GROUND pass
of pebbles/carpet/mounds/stones/low wood, and a `back` CANOPY pass of tall
weed. `scene/backdrop-sprites.ts` is the sprite-mode twin, sharing the scatter
in `scene/scatter.ts`. The theme keeps everything a human curated; these files
own only the background texture behind it.

**Each band carries its own `envelopeFloor`, and that is the whole design.**
The first version of this ran every band at 0.75 — near-even coverage at every
height across the full width. It closed the frame into a hedge, buried the
driftwood the composition is built around, and read as clutter rather than as
a tank. `assets/images/scene/scene.png`, the reference art, does the opposite
and is worth opening before touching any of this: two dense clusters on the
flanks, a genuinely **open centre**, and nothing crossing the middle but pale
low silhouettes and a scatter of pebbles on the sand. So bands take opposite
density profiles by job:

| band    | floor     | why                                                                                                        |
| ------- | --------- | ---------------------------------------------------------------------------------------------------------- |
| pebbles | 0.90      | even across the sand — the only thing crossing the open middle, and what stops it reading as a blank sheet |
| far     | 0.55      | fairly even, but every variant capped low (~20% of frame) so the centre reads as depth, not as a hole      |
| ground  | 0.30–0.45 | flank-weighted, thinning through the centre                                                                |
| canopy  | 0.10      | **flanks only** — this is the band that closes a tank                                                      |

Ground and canopy are separate bands rather than one pool because they compete
otherwise: `pickVariant` weights by `1 - |variant.height - u|`, so a single
pool holding both pebbles and tall weed resolves almost entirely to one of
them and the other disappears.

Three rules, all of which the file's header states and one of which is a
compile error:

- **`far`/`back` only.** `BackdropLayer` is `Extract<SceneLayer, "far" | "back">`.
  Since the composition invariants rasterize mid+front as an allowlist, a fill
  confined to the back provably cannot move occupancy, corridor, spaciousness,
  the focal apex, or the asymmetry ratio — which is the entire reason it can
  add real mass without renegotiating the authored composition.
- **Scales are literals from a fixed variant pool, never computed.**
  `compose.ts`'s `bakeKey` excludes `worldX`, so N placements sharing a
  (species, layer, seed, scale, mirror) tuple cost ONE texture. 108 placements
  currently collapse onto 31 bakes. A continuous scale (`base * envelope`)
  would give one bake per placement and thrash the LRU — which presents as a
  permanently low frame rate with no visible artifact. So the U envelope picks
  WHICH variant; it never scales one. **Density is free; variety is what
  costs.**
- **`mirror` belongs only on driftwood.** It's part of `bakeKey` and every
  other species ignores it, so setting it elsewhere forks a pixel-identical
  second texture for nothing.

Sprite mode adds two constraints the procedural side doesn't have. The PNGs
are **fixed-resolution**, so `scale` has a real ceiling — `compose-sprites.ts`
multiplies by `sizeFactorFor` = 0.6, meaning scale ~1.7 draws a piece at its
native pixel size and anything past that is upscaling (the tallest asset is
414px, which is what caps the canopy at roughly half a portrait column). The
authored driftwood deliberately breaks that ceiling, because bark has almost
no detail to lose — the same treatment on a fern reads as a blurry fern.
And `SpritePlacement.maxHeightFraction` exists because `sizeFactorFor` clamps
to its 0.6 floor at **both** 390x844 and 844x390, so a piece sized as a
portrait centrepiece is drawn at the identical pixel height in a 330px
landscape column, where it becomes a wall. `verify-aquarium.ts`'s corridor
check at 844x390 is what catches a missing cap.

A **mossy rock** is two sprites, not one: there is no mossy-rock PNG, so a
variant can carry a `companion` placed at the host's foot (that is where
`scene.png` puts moss, and perched on the crown it read as a green hat).
Companions stay under `CLIMBABLE_MIN_HEIGHT` so they don't become redundant
snail props beside the rock they're attached to.

The fill is **not draggable in the Scene tab**, by construction: it's spread
into the theme as an identifier (`...BACKDROP_FILL`), and `placement-patch.ts`
only sees `{...}` literals keyed by a unique seed — while the fill
deliberately REUSES seeds, which is exactly what bounds its bake count. The
editor's live preview does render it. Tune it by editing the pools, then
`yarn aquarium:preview`.

Two things this needed from the generators, both of which were real bugs:

- **`lean`/`curve` now scale** in `generateVallisneria` and `generateCabomba`.
  They didn't, so `scale` changed a plant's _silhouette_ rather than its size
  — a small clump splayed and a large one went rigid, turning a tall canopy
  clump into a picket fence of parallel needles. The blade taper also went to
  0.7 from 0.85, since the top third of a tall blade was thinning below a
  pixel and dropping out of the silhouette.
- **Driftwood's bbox is computed, not guessed.** See `gen/driftwood.ts`'s
  header: the old `{x: -baseWidth, ...}` only held for a vertical trunk, so
  every limb leaning further than `baseWidth` from the origin baked CLIPPED.
  That piece was commented out of the theme entirely, which orphaned four
  `anubias` still carrying `attachToId` — `composeScene` no-ops silently on a
  missing target, so they were rendering as ground plants at the wood's
  `xFraction`.

**Kelp is gone from the theme** (the generator remains; nothing places it). At
~20:1 aspect with three non-overlapping fronds and a blunt flat top it read as
flat dark planks rather than foliage, and at ~1MB per bake it was the single
most expensive species in the tree — a third of the decor budget spent on the
worst art in the scene. The canopy pass supplies the tall edge framing it was
there for. Bring it back only if its silhouette is rebuilt first.

### Bake budget — the invisible failure mode

`render/decor-cache.ts` bakes **synchronously inside render** and evicts by
LRU, so a theme whose distinct `bakeKey`s don't all fit in
`DECOR_BUDGET_BYTES` re-bakes evicted pieces every frame. That reads as a
permanently low frame rate with nothing visibly wrong to bisect from, which is
why `verify-aquarium.ts` §8 now checks it: the working set summed per bakeKey
against a 25% margin (margin, not a bare fit — the LRU is a module singleton,
so a rotation transiently holds both canvas sizes' key sets), no single bake
over 1.5MB, and that the fill still collapses onto its pool.

Bake resolution is per depth band (`core/decor-budget.ts`'s
`DECOR_DPR_BY_LAYER`): 1.4 for `far`, 1.5 for `back`, 2 for `mid`/`front`.
Bytes go as DPR squared, and the two back bands hold nearly all of a theme's
pixels while being the bands nobody can inspect — 0.45 and 0.7 opacity, behind
every fish, drifting under parallax. Baking them at foreground fidelity spent
~2x the bytes on the half of the scene that is deliberately out of focus, and
that waste was exactly the budget a densely-planted background needs. Safe to
key off the layer because `bakeKey` includes it, so a piece can never be
looked up at a DPR it wasn't baked at.

`render/scene-layers.tsx` also splits `StaticDecorPiece` from
`SwayingDecorPiece`: hardscape and ground cover have `swayHeight === 0` and a
constant transform, so they don't need the per-frame `useDerivedValue` worklet
that reads the clock. The branch is stable per key (`swayHeight` is a property
of the generated art, not of render state), so it can't swap a hook-using
component for a hookless one under the same key.

### Parallax

`render/parallax.tsx`'s `useCameraX()` is a slow autonomous horizontal drift
(a sine wave, `layers.parallaxAmplitude`/`parallaxPeriodSec`) — the closest
thing this renderer has to a camera. `ParallaxGroup` applies a per-band
fraction of it (`layers.parallaxFar/Back/Mid/Front`) so far decor drifts
least and front decor most, which is what actually sells depth once a fourth
band existed to show it against. Each fish band is wrapped in the SAME
`ParallaxGroup` as its matching decor layer (in `aquarium-canvas.tsx`) so
fish never slide against the scenery they weave between. `AquariumSubstrate`
overscans by a fixed margin (`OVERSCAN` in `water.tsx`) comfortably past the
max drift so panning never reveals canvas past the sand. Static tooling
(verify/preview/editor) never renders through this component, so it composes
at rest (camera = 0) — parallax needs no accounting there.

### Substrate texture

`AquariumSubstrate` moved from a flat gradient rect to `core/sksl/substrate.ts`'s
shader — the same gradient plus static per-pixel grain and a sparse darker
speckle scatter (`substrate.grainStrength`/`speckleDensity`/`speckleColor`),
no time uniform since sand doesn't move. `aquarium-preview.ts`'s sand pass
uses the identical effect so the preview stays pixel-matched to the app.

### Sprite mode (A/B art comparison)

A second, opt-in background-art path exists purely for comparing "generated"
vs "shipped PNG" art side by side: `scene/sprites/` (`sprite-manifest.ts`'s
data + `sprite-sources.ts`'s `require`s), `scene/compose-sprites.ts`, and
`scene/themes/nature-scape-sprites.ts` mirror the procedural
scene/compose/theme trio but for individual painted pieces instead of
generated species — `render/sprite-layers.tsx` draws them with no bake/cache
step, since the PNG already is the texture. `useSceneArtStore`
(`@/shared/store/scene-art-store.ts`) is the toggle (Tank screen's "Scene:"
button, shown whenever the Renderer toggle is on 2D V2), independent of the
Renderer (2D/3D) toggle.

The 22 pieces currently in `assets/images/scene/` (`driftwood-log`,
`driftwood-branch`, `driftwood-branch2`, `rock-a`/`rock-b`/`rock-huge`/
`rock-small`, `kelp`, `tall-grass`, `grass-spiky`, `rotala-tall`, `cabomba`,
`anubias-a`/`anubias-b`, `fern`, `moss-ball`, `leafy-clump`, `leafy-bush`,
`grass-tuft`, `sand-patch`, `pebble`, `pebble-brown`) are real painted art —
cropped from two hand-supplied sheets by `scripts/extract-scene-pieces.ts`
(now parameterized: `extract-scene-pieces.ts <file> [stripBottom]`), which
reconstructs alpha (neither source has any — see that script's header), runs
connected-component detection, and renders a labeled contact sheet so each
crop can be identified by eye before naming it. `scene.png`'s TOP section —
a complete pre-composed scene — is a style reference only (palette, mood,
composition balance), never drawn directly; an earlier version of this mode
tried exactly that (stretch the whole reference image to fill the canvas)
and it looked good but couldn't interleave with fish depth bands or tune
composition per canvas size the way individually-placed pieces can.
`pieces.png` is a second, pure piece sheet (no reference strip, so
`stripBottom=0`) that supplied the size-variety pieces added later
(`rock-huge`/`rock-small`, `leafy-bush`, `grass-spiky`, `pebble-brown`).

`driftwoodBranch`/`driftwoodLog` are placed once each (left focal point,
smaller mirrored right-side echo via `mirror: true`) — the same
one-PNG-both-sides trick `gen/driftwood.ts`'s `mirror` flag does
procedurally. Sprite mode has no procedural water shader of its own, so
`render/sprite-layers.tsx`'s `SpriteWater` is a static gradient using colours
sampled from the reference art (noticeably brighter/more pastel-cyan than
the procedural theme's default teal) rather than
`DEFAULT_SCENE_DESIGN.water`. `SpriteSubstrate` draws a solid gradient fill
(sampled from `sand-patch.png`'s own tone) before stretching the sand piece
over it — the piece is a rounded clump, not a straight strip, and without
the fill its curved edge shows water peeking through at the canvas corners.

`yarn aquarium:design`'s **Sprites tab** (alongside Shape/Motion/Scene — see
`scripts/aquarium-design-editor.ts`'s header) is the live editor for this
mode: a Placements section (drag pieces in a real server-rendered preview,
or edit `xFraction`/`scale`/`mirror` directly — saves into
`nature-scape-sprites.ts` in place via `scripts/lib/sprite-placement-patch.ts`,
keyed by array index since `SpritePlacement` has no unique id, unlike the
procedural theme's `seed`) and a Colours section (water/sand swatches —
saves into `render/sprite-layers.tsx` directly via
`scripts/lib/hex-const-patch.ts`, the same one-line-at-a-time patch idea as
`swim-const-patch.ts` but for a quoted hex string instead of a number).
Adding/removing a placement or changing `spriteId`/`layer` is Copy-code
only, same split every other tab uses for structural edits. Run
`yarn verify:aquarium` after saving from this tab.

If the manifest is ever empty (no sprite art available), every consumer
(the canvas, `aquarium-preview.ts`'s second composite row,
`verify-aquarium.ts`'s sprite occupancy section) degrades to "nothing to
draw" rather than failing; see `sprite-manifest.ts`'s header for the process
to add or replace a sprite.

## Behaviour

Two engines, not one. Everything that swims runs `sim/swim.ts` (below);
`locomotion: "crawl"` species run `sim/crawl.ts` instead — see "The snail
doesn't swim" above, and note the two share nothing but `wrapToPi`.

**`hover` is short on purpose, and the reason is a trap worth knowing.**
Its duration (1.2-2.6s) and speed (0.28x) look timid next to the other modes
because they were retuned after hover started actually running. Hover's
target is a jitter within `HOVER_JITTER` (20px) of the fish, and arrival
used to be `hypot(dx, dz) < ARRIVE_RADIUS` (26) — so hover retargeted out of
itself within a frame or two and measured **0.3% of elapsed time** in the
shipped build. Excluding hover from arrival fixed that bug and let its
original, never-exercised 3-6s duration at 0.12x speed run for the first
time: **18% of all time**, with stalls up to 9.4s, i.e. "the fish keeps
stopping for no reason". None of the existing swim checks caught it — they
measure mean speed and turn behaviour, and a fish that is motionless an
eighth of the time still has a fine mean. `verify-aquarium.ts`'s swim trace
now asserts stalled-time and longest-stall directly (`STALL_VX`). Re-run it
rather than eyeballing if you touch a mode's duration, speed or transition
weights.

This renderer owns its own steering (`sim/swim.ts` + `sim/use-v2-swim.ts`) —
it does NOT bias the shared `@/shared/hooks/use-fish-swim.ts` /
`@/shared/lib/swim-model.ts` engine 3D uses (an earlier version of this doc
described it that way; that stopped being true once "don't flip, turn around
by moving" needed a real heading, not a binary `facingRight`). `sim/swim.ts`
only _imports_ `wrapToPi`/`MAX_DT` from the shared model — both pure,
side-effect-free — everything else is its own.

**Why a real heading, not a flip.** The old model steers `(x, y)` and signals
facing with a boolean; `use-fish-swim.ts` renders a direction change as
either a mirror or a timed 420ms `rotateY` sweep — visually, the fish flips
over. `sim/swim.ts` instead steers a particle through `(x, z, y)` — `x`
screen-horizontal, `z` depth (toward/away from the glass, boxed at ±`Z_MAX`,
a STEERING variable only, never fed into which scenery band a fish draws
in), `y` a separately-damped vertical approach — and `yaw = atan2(dz, dx)` is
a continuous heading. A U-turn is a turn-rate-limited arc through yaw values
near ±π/2 (edge-on to the viewer), the same way an actual fish turns in
three dimensions, not a discrete state flip.

`render/fish-layer.tsx` turns `yaw` into a screen transform via a hand-built
six-entry `Transforms3d` stack — `translateX/Y`, `rotate` (pitch, killed at
edge-on by `Math.cos(yaw)`), a `{matrix: Matrix4}` entry doing the mirror +
perspective (`w = -sign(cos yaw)·max(|cos yaw|, EDGE_ON_MIN_WIDTH)`,
`q = sin(yaw) / (PERSPECTIVE_RATIO · onScreenWidth)`), then `scaleX/scaleY`
— not a plain `rotateY`, which would either plateau visibly at a clamped yaw
or make the sprite blink to near-zero width for ~11 frames at true edge-on.
`EDGE_ON_MIN_WIDTH` is a width FLOOR baked into the matrix, not a yaw clamp,
so the fin silhouette (full dorsal, full caudal fan, the eye) stays readable
through the thinnest part of a turn. `roll` is a genuine longitudinal bank
into the turn (collapses to `Math.cos(roll)`'s vertical squash under the
matrix), not the old model's `bank`, which was actually a pitch.

A cozy-tank "broadside bias" (`BROADSIDE_BIAS` in `sim/swim.ts`) pulls
`yawDesired` toward whichever of "facing screen-right" or "facing
screen-left" is nearer whenever the fish isn't actively steering toward a
target or avoiding a wall — the art is the point, so a fish mostly presents
its flank; `z` travel happens in gentle diagonal drifts instead of the fish
spending long stretches face-on to the viewer.

**A leg is a full-width crossing.** `crossTargetX` in `sim/swim.ts` aims
every non-hover target at one END of the wander box — the end the fish is
already pointed at while it still has room, the other one once it is inside
`REVERSE_ZONE` — so the fish traverses the tank and changes facing only when
it gets there. This replaced a uniformly random `lerp(minX, maxX, rand())`
target, and three separate things had to change together before the fish
stopped reversing on the spot; all three are easy to reintroduce:

- A random target lands **behind** the fish half the time and only ~W/3 away
  on average, so a reversal happened wherever the fish happened to be.
- Arrival measured `hypot(dx, dz)`, so an unfinished **depth** component
  kept a leg open after the horizontal trip was done: the remaining vector
  was pure `z`, `yaw` sat at ±π/2 and the sprite's facing flip-flopped while
  the fish made no horizontal progress. Arrival is on X alone now, and
  `DEPTH_WANDER` bounds `targetZ` to a wander around the current `z` (same
  reasoning as `VERTICAL_WANDER` for `y`) so depth can never outvote the
  crossing.
- **Hover** steers not at all now (`holdYaw`), not merely inside the
  `nearTarget` freeze radius: its target is a jitter around the fish's own
  position that lands behind it half the time, and the z part of that jitter
  alone could push it past the freeze radius and spin the fish for a 20px
  move.

Mode changes mid-leg keep the crossing (`keepCrossing`) — only arriving
picks a new end — and `verify-aquarium.ts`'s swim trace asserts the mean leg
spans ≥45% of box width, which is the check that would have caught any of
the above. Turn RATE is separate: `TURN_RATE_REVERSE` scales the yaw ceiling
with heading error, so the about-face itself takes ~0.6s rather than the
~2.1s a wall-keyed ceiling gave a mid-tank turn.

**The shared current.** `sim/swim.ts` carries a slow horizontal flow on a
~42s cycle (`CURRENT_FREQ`) that advects every molly together, so the tank
reads as one body of water rather than N independent particles.
`render/scene-layers.tsx` leans decor sway on the _same_ exported signal
(`currentAt`), which is where most of the effect actually lands visually —
plants and fish visibly answering one flow. It's opt-in per caller
(`useV2Swim`'s `currentStrength`, default 0), and `render/creature-layer.tsx`
passes nothing, so the five creature species keep their original independent
motion.

Two things about it are worth not re-learning the hard way, both measured:

- It **advects position, and carries `targetX` with it** — it does not bias
  heading. A first version blended `yawDesired` toward the flow instead, and
  that measurably made the tank _less_ coherent (heading coherence
  0.281 → 0.260): re-aiming every fish the same way marches them into the
  same wall, where wall-avoidance necessarily overrides the current and
  scatters them. Advecting the fish but _not_ its target is also wrong — the
  steering loop is a position controller and simply swims against the drift,
  cancelling it (−20% collective motion).
- Its effect is **invisible in a small sample**. With 12 fish, individual
  wander is an ~89px centroid noise floor that completely masks it; the
  correlation against the current's own signal reads as zero. Averaged over
  400 fish the signal is unambiguous: centroid sway of **66px with the
  current on vs. 10px off**, on the expected ~42s period. Measure it that way
  or you will conclude, wrongly, that it does nothing.

`sim/personality.ts` still derives a few deterministic per-fish traits from
the fish's seed (`boldness`, `restlessness`, `speedFactor`, `depthBias`):
bolder fish get a smaller edge inset, `speedFactor` scales cruise speed, and
`depthBias` narrows/shifts the vertical wander band toward a preferred
depth — these bias `sim/swim.ts`'s own wander box and speed factor, same
role as before, just against 2D V2's own engine now instead of the shared
one.

## Verification

There's no test runner in this repo yet (see `CLAUDE.md`).
`yarn verify:aquarium` (`scripts/verify-aquarium.ts`) is the closest thing —
run it after any change under `fish/` or `scene/`:

- Anatomy invariants for all 8 body/tail/dorsal combos: the body has a real
  peduncle (not barrel-shaped), the body outline and every fin polygon are
  simple (no self-intersection), every "sunk" fin hub lands genuinely inside
  the body by its `sink` value (the buried-root trick actually works), and
  every fin's median tip reaches clearly outside the body (it actually
  shows).
- Body-proportion invariants (art direction, made checkable): aspect ratio
  within a target band per body, crest/belly position, snout bluntness, and
  an on-axis peduncle — see **Art direction** above. Encodes the design
  brief as a real assertion so a future edit can't silently drift the body
  back toward something else.
- A real bake of all 16 colours, every anatomy combo, every life stage —
  through the SAME emitter (`core/emit.ts`) the app draws with, via
  `scripts/lib/skia-node.ts` (CanvasKit-backed Skia running under plain
  Node — the same real `Skia` JS API the device uses, not a mock).
- Spine-warp round-trip accuracy, fold-safety (injectivity budget — measured
  against real bake bounds across a full 24-phase beat sweep, not a guessed
  `nMax` at one phase), padding coverage, and shader-vs-TS-math agreement
  (sampled points, compared against what the compiled SkSL actually produced
  when rendered).
- Scene composition: real pixel occupancy per column (bake the placed
  mid/front decor and read back alpha, not a bbox-width sum — a thin leaning
  driftwood trunk registers its whole canopy span as "blocked" under a bbox
  sum even though almost all of that span is open water) at three canvas
  sizes (390×844, 430×932, 844×390), asserting: mean occupancy, a genuine
  corridor exists, spaciousness (mid+front occupied area vs canvas), the
  tallest mid-layer reach lands near a rule-of-thirds line and not dead
  centre, and left/right decor weight is asymmetric by design.
- A headless swim trace (`sim/swim.ts`, 20 seeds × 60s at 60Hz, no Skia, no
  React): no NaN, positions stay in bounds, yaw never exceeds the steering
  law's own turn-rate ceiling in one step, the edge-on width floor's sign
  never crosses zero, and statistical properties (mean edge-on time, heading
  reversal rate, mean forward speed) averaged across seeds rather than
  asserted per-seed — individual-seed edge-on time varies ~8%-16% by design
  (which target a fish happens to wander toward), so a per-seed assertion
  would flake on that natural spread. The whole trace runs **twice**, with
  the shared current off and on, because the current perturbs position and
  could in principle break the bounds/turn-rate guarantees.
  It also asserts a **straightness index** (net displacement ÷ path length
  over 5s windows) inside the 0.35–0.75 band real cruising fish occupy —
  currently 0.49 off / 0.51 on. This is the check that catches the classic
  steering regression where a persistent heading-relative offset acts as a
  constant turn and every fish quietly starts swimming in circles (that
  failure reads as < 0.15; > 0.9 means they're on rails instead).

`yarn aquarium:preview` renders every colour × life stage + every
body/tail/dorsal combo to `src/docs/aquarium-preview.html`, the same
iteration-loop role `fish:preview` plays for the old pipeline — real bakes,
not an approximation. It also renders a **yaw strip** (the baked fish through
`fish-layer.tsx`'s exact perspective matrix at 9 headings, via
react-native-skia's own `processTransform` against a real canvas — not a
reimplementation) and a **full-scene composite** at 390×844 and 844×390 (the
real composed decor at placed positions, with the swim lane marked) — both
exist specifically because there's no device in this environment to check
the transform math or the composition by eye any other way.

## What's not built yet

- The full behaviour engine (forage/graze/rise/startle modes, point-of-interest
  seeking) — `sim/personality.ts` only biases `sim/swim.ts`'s wander box and
  speed factor, same small slice of "behaviour" as before.
- Per-species current response — the shared current (below) advects every
  molly identically; it doesn't yet vary by body size or personality, and the
  five creature species opt out of it entirely.
- A device-tier quality ladder (drop the shader warp / caustics / god rays on
  low-end hardware). Nothing in this tree has been run on a device yet —
  every check above is headless (Node/CanvasKit). Treat a real device pass as
  outstanding before trusting this further.
- More decor species (cryptocoryne, dwarf hairgrass, java moss) — the
  `scene/gen/` + `scene/compose.ts:GENERATORS` seam is designed for this to be
  additive.
- Independent limb articulation for any creature (a frog's hop-kick, an
  otter's paddle-stroke) — every limb is static geometry on a
  swim-transformed sprite, deliberately cut from this pass.
- A per-variant unlock economy within a species (mirroring molly's
  individually-gated colors) — mitigated instead via one deliberately
  low-weight "chase" variant per species plus Fishdex "seen" tracking, not a
  second unlock system.

### Sprite mode's ground is not a sprite

`SpriteSubstrate` used to stretch `sand-patch.png` across the whole canvas
width. **Open that asset before ever considering going back**: it is a small
rounded _oval patch_ of sand carrying eight big painted pebble blobs — a
decorative piece you scatter, not a floor. Pulled edge to edge it blew those
eight blobs into huge evenly-spaced dark ellipses, smeared the grain
horizontally (421px of art across an 844px canvas), and stretched its oval
silhouette into a lens. One small sprite pretending to be a whole seabed, and
it was the single most artificial-looking thing in the scene.

The ground is procedural again — the same `core/sksl/substrate.ts` shader the
2D theme uses (gradient + per-pixel grain + sparse grit specks), which is
resolution-independent, never stretches, and costs one draw call. Sprite mode
only overrides the palette (warmer and lighter, sampled from `scene.png`) and
runs grain/speckle higher, because the painted art it sits under has visible
texture everywhere and a smooth floor under it read as the odd one out.

Two details carry most of the realism, and both are cheap:

- **The top edge undulates** (`useSandPath` — two sine terms at
  incommensurate frequencies, so the wobble never visibly repeats and needs no
  rng). A substrate meeting the water on a perfectly straight horizontal rule
  reads as two stacked rectangles. Amplitude is capped under the smallest
  `LAYER_SINK_PX` so a trough can never expose the foot of a piece resting on
  the line.
- **A seam shadow** fades down from that edge into the sand, clipped to the
  same path so it follows the surface rather than cutting across it. It is
  what makes the water look like it is sitting _on_ the floor.

`sandPatch` stays in the manifest as a placeable decor piece, which is what it
was always meant to be. `scripts/aquarium-preview.ts` duplicates all of these
constants (a Node script cannot import the `.tsx`) — keep the two in sync.
