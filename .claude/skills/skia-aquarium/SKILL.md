---
name: skia-aquarium
description: Draw and animate lifelike 2D fish and other aquatic creatures in React Native using @shopify/react-native-skia and react-native-reanimated. Covers procedural fish anatomy (body outline from a spine, caudal/dorsal/pectoral fins), biologically-grounded swimming motion (traveling-wave undulation, burst-and-coast, schooling, wall avoidance), species presets (guppy, molly, betta, neon tetra, angelfish, corydoras, goldfish, shrimp, snail, tadpole/frog), and full tank scenes (water gradient, caustics, bubbles, swaying plants, touch feeding). Use this skill whenever the user mentions drawing, animating, or building a fish, aquarium, fish tank, koi pond, underwater scene, or swimming creature in a mobile app — and also whenever they ask for Skia canvas creatures, procedural animation, boids/schooling, or "make the movement look more natural" in a React Native context, even if they don't name a specific library.
---

# Skia aquarium

Build 2D aquatic creatures in React Native that look hand-drawn but move like real animals.

The central idea: **never draw a fish as a static sprite that slides around.** A fish is a
*spine* (a line of vertebrae) plus a *width profile*. Every frame you bend the spine with a
traveling wave, extrude the outline from it, and hang fins off known vertebrae. That single
choice is what separates convincing fish from clip-art on a path.

## Before you write code

Check what the project actually has, because the API changed shape recently:

```bash
cat package.json | grep -E "react-native-skia|reanimated"
```

- `@shopify/react-native-skia` 2.10+ requires **Reanimated 4+**. Below 2.10, Reanimated 3 is fine.
- Skia 2.x uses the **immutable path API**: `Skia.PathBuilder.Make()…build()`. Older versions use
  the mutable `Skia.Path.Make()`. `assets/fishMath.ts` ships a compat shim (`newPathBuilder`,
  `finishPath`) so the same code runs on both — use it rather than picking one.
- If neither library is installed, say so and give the install commands before writing the scene.

## Pick a rendering tier first

Fish count drives the whole architecture. Choose deliberately and tell the user why:

| Fish on screen | Approach | What you get |
|---|---|---|
| 1–15 | **Deformed spine** — rebuild each body `SkPath` every frame | Full undulation, individual fin motion. The default. |
| 15–40 | **Rigged groups** — one static body path per species, nested `<Group transform>` for head/body/tail | Segmented wiggle, ~free. Reads fine below ~60px. |
| 40+ | **Atlas** — `useRSXformBuffer` + `<Atlas>`, one draw call | Dense schools, no per-fish deformation. |

Mixing tiers is normal and good: three hero fish deformed, twenty background tetras on an atlas.

## The four layers

Build in this order. Each layer is independent and testable on its own.

1. **Steering** — where the fish wants to go. Produces `(x, y, heading, speed)`.
   Vector-accumulated wander + schooling + wall avoidance. See `references/motion.md`.
2. **Spine** — bend the body. Traveling wave in body-local space plus a turn-bend term.
3. **Skin** — extrude the outline from spine + width profile, smooth with Catmull-Rom.
4. **Scene** — water, light, plants, bubbles, depth. See `references/scene.md`.

Getting layer 1 and 2 right is 90% of "natural". A beautifully drawn fish that translates in a
straight line looks dead; a crude ellipse with correct undulation and burst-and-coast reads as
alive.

## Quick start

The files in `assets/` are working, self-consistent implementations. Copy them into the project
and adapt rather than writing from scratch:

- `assets/fishMath.ts` — worklet-safe math: spine building, outline extrusion, fins,
  Catmull-Rom→Bézier, angle helpers, the Skia path compat shim.
- `assets/species.ts` — tuned presets for eleven creatures (shape + motion in one object).
- `assets/useSchool.ts` — the steering simulation on a `useFrameCallback` loop.
- `assets/Fish.tsx` — one deformed fish, tier 1.
- `assets/Aquarium.tsx` — a complete tank wiring it all together.

Read `references/skia-api.md` before editing them — it covers the worklet and shared-value
gotchas that cause the two most common failures (frozen animation, dropped frames).

## Non-negotiables for looking natural

These come from swimming kinematics and are the things people most often get wrong. The
reasoning behind each is in `references/motion.md`.

- **Amplitude grows toward the tail.** The nose barely moves. Use an envelope like
  `A(s) = 0.02 − 0.0825s + 0.1625s²` (body lengths, `s` = 0 at nose, 1 at tail). A uniform-amplitude
  sine makes the fish look like a wiggling worm.
- **The wave travels backwards.** Phase must lag along the body (`sin(2πs/λ − ωt)`), never a single
  synchronized swing. This is the whole illusion.
- **Tail-beat frequency scales with speed**, not with wall-clock time. A drifting fish beats slowly;
  a bursting one beats fast. Drive `ω` from current speed.
- **Fish coast.** Real fish burst then glide, they don't cruise at constant velocity. Without this
  the scene looks mechanical no matter how good the wave is.
- **Turns cost speed and bend the body.** Add a `s²`-weighted lateral offset proportional to angular
  velocity so the body arcs into the turn, and reduce speed when turning hard.
- **Fins lag the body.** Pectorals scull out of phase left/right; the caudal fin trails the peduncle.
  Zero lag reads as rigid.
- **The body must not stretch.** Space vertebrae by arc length, stepping a fixed segment along the
  curve — not at fixed `x` with a wave added on top. The naive version grows 5–10% per beat.
- **Fins are membranes, not shapes.** Light passes through them. Draw each fin with an alpha
  gradient falling from ~90% at the base to ~35% at the trailing edge, and stroke a few rays over
  the caudal. An opaque fin is the clearest signal that a fish was generated rather than drawn.
- **Fish bank into turns.** Squash perpendicular to the heading in proportion to angular velocity
  (`scaleY` about the fish's own axis). This fakes roll convincingly in pure 2D and is the cheapest
  fix for a side-on fish reading flat.
- **Nothing is synchronized.** Randomize each fish's phase offset, tail-beat rate (±15%), scale
  (±10%), and burst timer at spawn. Identical fish in lockstep is the single most artificial cue.

## Measuring against art-directed references

Cozy aquarium games (Pondlife, and the rest of that genre) are art-first: hand-illustrated
species, bone-rigged by an animator, played back over painted backgrounds. This skill is
math-first. The motion is more rigorous — a simulated fish never loops, and a rigged one always
does — but hand animation buys expressiveness that simulation does not give you for free.

Be honest with the user about where the line falls, and reach for the cheap approximations rather
than trying to out-render a painter:

| What authored art gives you | Cheap procedural approximation |
|---|---|
| Painted scales, subsurface glow | Belly counter-shading + one clipped gradient. Won't fully close. |
| An attractive silhouette | Asymmetric back/belly profiles, a head wedge, gill and mouth lines. Helps a lot, still reads as vector art. |
| Translucent, rayed fins | Alpha gradient + stroked rays — closes most of the gap |
| Banking, three-quarter views | `scaleY` squash from angular velocity — closes most of the gap |
| Anticipation before a dart | Brief speed dip before a burst fires |
| Squash and stretch | Deliberately not available: the spine is arc-length locked. Trade-off, not a bug. |
| Idle personality | Hover state with tail amplitude eased down to ~0.35 |
| Painted backgrounds | No substitute. Recommend authored art behind a procedural foreground. |

If the user genuinely needs painted-quality creatures, the honest answer is a different pipeline:
author each fish as a texture and deform it with Skia's `Vertices` mesh driven by the same spine
solver, keeping this skill's motion and gaining hand-painted surface. Say so rather than
over-promising what flat vector fills can reach.

## Coordinate conventions

Skia's canvas is **y-down**. The shipped math assumes:

- The fish faces **+X** in body-local space; the nose sits at local `(0, 0)`, the tail at `(−L, 0)`.
- `side = −1` is the fish's **back** (dorsal, appears on top); `side = +1` is the **belly** (ventral).
- `s` is normalized arc length from nose (0) to tail (1).
- Headings are radians, `atan2(dy, dx)`, and always compared with a shortest-angle helper.

Blend angles as **vectors**, never by scaling angle differences — scaling a wrapped difference
flips sign near ±π and sends creatures shooting off screen. This was verified empirically; see
`references/motion.md`.

## Reference files

Read the one that matches what you're doing:

- `references/motion.md` — swimming kinematics, the steering model, tuned constants with the
  straightness-index measurements that justify them, schooling, feeding and startle behaviours.
- `references/species.md` — per-creature shape and motion parameters, plus how snails, shrimp,
  tadpoles and frogs differ from fish (they need different locomotion models entirely).
- `references/skia-api.md` — the RN Skia + Reanimated API surface you need, worklet rules,
  shared-value patterns that actually re-render, and the performance checklist.
- `references/scene.md` — tank composition: water gradients, caustics via runtime shader, bubbles,
  plant sway, substrate, depth parallax, and touch interaction.

## Be honest about the ceiling

Flat vector fills have a hard limit, and it is reached faster than you would like. Asymmetric
back/belly profiles, a wedge head, a gill arc and a properly placed eye take the silhouette from
"sausage with a triangle stuck on" to "clearly a fish" — but not to "attractive". Further tuning of
shape constants hits diminishing returns quickly.

If the user says the fish look ugly, do not respond by tweaking width arrays a fourth time. Tell
them the pipeline is the constraint and lay out the two real options:

1. **Stay procedural.** Accept a clean, flat, graphic look and lean into it — bold flat colour, a
   strong silhouette, no attempt at painterly detail. This looks deliberate rather than deficient.
2. **Author the art.** Draw each species once as an SVG or PNG, build a triangle mesh over it, and
   deform it through Skia's `Vertices` API driven by this skill's spine solver. Motion quality is
   retained; surface quality becomes whatever the artist draws.

Option 2 is what every polished aquarium app on the stores actually does. Recommending it early
saves everyone a long, unsatisfying tuning loop.

## Verifying your work

You cannot see the simulator, so check these instead — they catch most breakage:

- Log 10 seconds of one creature's positions and confirm it stays inside the tank and its
  straightness index (net displacement ÷ path length over ~5s) lands around **0.35–0.75**.
  Below 0.15 means it's circling; above 0.9 means it's on rails.
- Confirm the tail's lateral excursion is roughly 5–10× the nose's over one beat. (Measured on the
  shipped presets: 4.5× for a betta, which barely undulates, up to 7.7× for a guppy.)
- Confirm total spine length varies by under ~3% across a full beat, and that the head does not
  drift in world space as the phase advances — both are cheap assertions worth keeping in a test.
- Confirm nothing depends on wall-clock frame count: every rate must be multiplied by
  `dt` (or `sqrt(dt)` for random walks) so the scene behaves identically at 60 and 120 Hz.
- Ask the user for a screen recording if the motion still reads wrong — describing what looks
  "off" (too fast, too stiff, too synchronized) maps directly onto the tuning knobs above.
