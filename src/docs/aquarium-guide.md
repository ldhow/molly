# The 2D V2 renderer — how it works

A second, self-contained 2D tank renderer living entirely under
[`src/shared/aquarium/`](../shared/aquarium/), selectable via the render-mode
toggle on the Tank screen (labelled **2D V2**) alongside the original 2D
renderer and the 3D renderer. Read this before changing anything under
`src/shared/aquarium/` — it's the equivalent of `fish-art-guide.md` /
`tank-3d-guide.md` for this tree.

## Why a second renderer, and how it's kept separate

The old 2D renderer draws a fish as three separately-baked layers (body,
tail, pectoral) with a rigid tail rotation and a body ripple that shears
cross-sections sideways instead of bending them. 2D V2 instead bakes body +
fins (each its own translucent shape, `fish/fins.ts`) into ONE texture and
animates the whole thing with a rigid spine bend, so the whole animal moves
as one piece even though the silhouette isn't a single outline anymore — the
"one organism bends together" property comes from the shared warp on one
baked texture, not from the outline itself being one path.

The whole thing lives in one directory so it can be deleted in one motion once
it replaces the old renderer:

```
src/shared/aquarium/
  core/       IR, the one Skia emitter, the bake cache, SkSL shaders
  fish/       anatomy (original silhouette), fins, pigment/patterns, spine warp math
  scene/      planted-aquarium generators, composition, themes
  sim/        steering (x,z,y swim model) + per-fish personality
  render/     React/Skia components — the only public surface
```

It imports **only**: `@/shared/fish/{types,catalog}` (trait/colour data,
read-only), `@/shared/fish/render-spec.ts`'s `DEAD_GRAYSCALE_MATRIX`/
`DEAD_OPACITY` constants (data, not code), and generic shared libs
(`@/shared/lib/*`, `@/shared/constants/tank.ts`). Never the old renderer's
components — including `@/shared/hooks/use-fish-swim.ts`: 2D V2 owns its own
steering (`sim/swim.ts`), see **Behaviour** below. See
[`aquarium/README.md`](../shared/aquarium/README.md) for the deletion
checklist.

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
   (eye, mouth, gill cover, blush) anchor to `u`-fractions of the head
   (`xAt(u)`, `topAt(u)`/`botAt(u)`) rather than absolute pixel offsets from
   the nose plane, so a future snout re-sculpt moves them automatically
   instead of needing another by-eye re-tune; the gill patch additionally
   scales with `landmarks.halfHeight` so it doesn't look undersized on a
   deeper head (balloon).

### Art direction

The body is a genuinely original design, not the legacy renderer's "chunky
realistic molly" resized — a plump, storybook-cozy companion fish.

**Surface treatment is a bold illustrated mascot, NOT soft painterly.** This
deliberately reverses an earlier "soft, storybook" pass, and the reversal is
the whole visual identity, so don't quietly undo it while tuning something
else:

- The contour is a near-opaque **2.1px solid keyline** (`opacity: 0.88`,
  almost no blur). It used to be `0.34` alpha / `1.1` width / `0.9` blur /
  `multiply` — that reads as a soft drop-shadow, not a drawn line, and it was
  by far the biggest thing separating this renderer from a clean illustrated
  look. `multiply` is gone too: it made the line's darkness depend on
  whatever it happened to sit over. Fin keylines follow at a deliberately
  lighter weight (`0.62`/`1.5`) — a fin is a translucent membrane, and an
  equally heavy outline makes it look like a solid paddle.
- Shading is **few, high-contrast layers**, not many soft ones. A short
  4-stop counter-shading sweep, one tight rear/belly AO, and exactly **one
  compact specular highlight** (a `scale.x = 2.2` ellipse at low blur).
  The previous stack — 7-stop counter-shading + softLight bloom + multiply
  shadow + a full-width blur-6 gloss stripe — averaged out to flat mid-tone
  at real viewing size.
- The eye keeps its sclera/ring/pupil/catchlight structure but is scaled up
  (`r` 4.8 → 6.3) with a thicker ring (1 → 1.7).

Per-variety palettes are untouched by that pass and stay authentic: Gold
Dust really does have a black head and dark fins, Sanke its red/black koi
blocks. Don't recolour the catalog toward one reference image — the style is
shared, the colours are each variety's identity.

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

2D V2 is also the ONLY renderer that draws non-molly species (otter, turtle,
frog, axolotl, snail) — the legacy 2D and 3D renderers only ever see the
molly individuals in a tank (`tank-view.tsx` filters the rest out before
handing `TankFish[]` to them). See `@/shared/lib/tank-fish.ts`'s header for
the `MollyTankFish`/`CreatureTankFish` discriminated-union trick that makes
that filter free (a `MollyTankFish[]` is structurally assignable wherever the
legacy `TankFish[]` is expected, so those two renderers needed zero changes).

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

**Locomotion.** Every species is `rigid` (swim-transformed but not
body-bent) except axolotl, the one `undulating` species — it's the only
non-molly body that spine-warps, sharing `fish/spine.ts`'s tuned amplitude/
wavenumber constants and `core/sksl/warp.ts`'s shader (both operate on a
baked texture's bounds generically; nothing about the warp itself is
fish-shaped). `render/creature-layer.tsx` is `fish-layer.tsx`'s non-molly
counterpart: same swim engine and perspective-matrix transform (a
DELIBERATE, documented duplication rather than a shared import, so this file
can never regress the fish renderer's own verified tuning), but branches on
`getSpeciesDef(speciesId).locomotion` to pick the plain `<Image>` path or the
same `WarpedBody`-style shader path `fish-layer.tsx` uses.

**Preview.** `render/creature-preview.tsx` bakes a `{speciesId, variant}`
through this same pipeline and renders it as a static, non-swimming
`<Image>` — every non-molly preview surface (the home-screen species picker,
the Fishdex, the Holding Tank tile) routes through it, since those species
have no legacy-renderer vector art to fall back to the way molly's `FishBody`
preview does.

**Verification.** `verify-aquarium.ts`'s "Creature bakes" section and
`aquarium-preview.ts`'s "Creatures" gallery section both iterate
`SPECIES_LIST` through the same `bakeCreature` dispatcher every render path
uses — a species graduating from placeholder to real anatomy is covered by
both automatically, no script change needed.

## How the tank is composed

`scene/` is a small procedural-decor system, not a fixed set of decorations:

- `scene/gen/*.ts` — pure, seeded generators (`driftwood`, `anubias`,
  `vallisneria`, `stemBush`, `seiryuStone`, `substrateMound`, `pebbles`,
  `kelp`, `bloom`), each returning IR nodes + a bounding box + (for driftwood) mount
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

## Behaviour

2D V2 owns its own steering (`sim/swim.ts` + `sim/use-v2-swim.ts`) — it does
NOT bias the shared `@/shared/hooks/use-fish-swim.ts` /
`@/shared/lib/swim-model.ts` engine the old 2D and 3D renderers use (an
earlier version of this doc described it that way; that stopped being true
once "don't flip, turn around by moving" needed a real heading, not a binary
`facingRight`). `sim/swim.ts` only _imports_ `wrapToPi`/`MAX_DT` from the
shared model — both pure, side-effect-free — everything else is its own.

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
