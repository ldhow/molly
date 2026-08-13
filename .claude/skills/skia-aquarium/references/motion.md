# Motion: making it swim, not slide

Two independent systems. **Kinematics** deforms the body. **Steering** decides where the body
goes. Keep them separate — steering knows nothing about vertebrae, kinematics knows nothing
about neighbours.

## Contents

- [Swimming modes](#swimming-modes)
- [The traveling wave](#the-traveling-wave)
- [Amplitude envelopes](#amplitude-envelopes)
- [Turning](#turning)
- [Burst and coast](#burst-and-coast)
- [Fin motion](#fin-motion)
- [Steering](#steering)
- [Schooling](#schooling)
- [Tank boundaries](#tank-boundaries)
- [Behaviour states](#behaviour-states)
- [Tuned constants](#tuned-constants)

## Swimming modes

Biologists classify body-and-caudal-fin swimming by how much of the body undulates. This maps
directly onto one parameter — the amplitude envelope — so it is worth knowing which mode your
creature uses.

| Mode | Undulating portion | Examples | Feel |
|---|---|---|---|
| **Anguilliform** | Whole body, amplitude large throughout | eel, loach, kuhli, tadpole | Ribbon-like, snaking |
| **Subcarangiform** | Posterior half | goldfish, trout, most community fish | Loose, flowing |
| **Carangiform** | Posterior third only | tetra, danio, mackerel | Stiff body, whipping tail |
| **Ostraciiform** | Body rigid, tail hinges | boxfish, pufferfish | Wagging, comic |
| **Labriform** | Body still, pectorals row | wrasse, mandarin, cichlid hovering | Hovering, oaring |

Most aquarium fish are subcarangiform. Bettas and angelfish spend much of their time labriform
(hovering on pectorals with almost no body wave), which is why a betta animated with a strong
tail wave looks wrong — it should mostly hang in the water and scull.

## The traveling wave

Work in body-local space: nose at `(0, 0)`, tail at `(−L, 0)`, fish facing `+X`. For each
vertebra at normalized arc length `s ∈ [0, 1]`:

```
y(s, t) = A(s) · sin(2π·s/λ − ω·t)
```

- `λ` — wavelength as a fraction of body length. `0.9–1.1` for most fish (about one wave visible
  on the body). Drop to `0.5–0.7` for eels and loaches to get multiple visible waves.
- `ω = 2π·f` where `f` is tail-beat frequency in Hz.
- The **minus sign** on `ωt` is what sends the wave from head to tail. Flip it and the fish
  appears to swim backwards even while moving forwards — a surprisingly common bug that is hard
  to spot but reads as deeply wrong.

**Frequency must follow speed.** Real fish beat faster to go faster; beat amplitude stays
roughly constant. Compute `f = fBase · (speed / cruiseSpeed)`, clamped to about `[0.35, 2.5]×`.
A fish that is drifting to a stop while its tail beats at full rate looks like a wind-up toy.

Do **not** advance the wave with a global clock. Integrate phase per creature:
`phase += 2π·f·dt`. Otherwise changing `f` teleports the tail (phase discontinuity → visible snap).

## Place vertebrae by arc length, not by x

The obvious implementation — put vertebra `i` at `x = −s·L` and add the lateral wave — **stretches
the body**. Measured across the presets in `assets/`, the spine grew 5–10% between rest and full
swing, so the fish visibly lengthens and shortens every beat. It reads as a rubber toy.

Step a fixed segment length along the curve instead:

```
seg = L / (n − 1)
x[0] = 0;  y[0] = lateral(0)
for i in 1..n−1:
  y[i] = lateral(i / (n−1))
  dy   = y[i] − y[i−1]
  dx   = sqrt(max(0, seg² − dy²))     // clamp: amplitude may exceed one segment
  x[i] = x[i−1] − dx
```

Total spine length is now exactly `L` at every phase, and the nose-to-tail *span* correctly
shortens as the body curves — which is what a real bending fish does. This dropped measured
stretch to under 3%.

The residual comes from the clamp firing when a single step's lateral change exceeds `seg`. It
only shows up on small fast-beating fish with large amplitude (neon tetra, guppy). If you raise
amplitude a lot, raise `segments` too, or the clamp will quietly shorten the body at peak swing.

## Amplitude envelopes

`A(s)` in body lengths. These come from measured kinematics of real swimmers:

```
carangiform      A(s) = 0.02 − 0.0825·s + 0.1625·s²      nose ~0.02L, tail ~0.10L
subcarangiform   A(s) = 0.02 − 0.06·s   + 0.14·s²        slightly looser mid-body
anguilliform     A(s) = 0.05 + 0.15·s                    large everywhere, linear growth
ostraciiform     A(s) = 0.005 + 0.09·s⁸                  flat until the very tail, then hinges
```

The carangiform curve dips slightly negative around `s ≈ 0.25` before climbing. That is real —
there is a node just behind the head where lateral motion is minimal — and it is part of why the
motion reads as a fish rather than a sine wave. Don't "fix" it by clamping to zero.

Head yaw: real fish recoil slightly, out of phase with the tail. Adding `A(0)` of about `0.02L`
(as the envelopes above do) is enough. More than that looks like the fish is shaking its head.

## Turning

Two effects, both required:

**Body arc.** Add a curvature term to the lateral offset so the body bends into the turn:

```
bend(s) = turnRate · L · s² · stiffness
y(s,t) = wave(s,t) + bend(s)
```

`turnRate` is signed angular velocity in rad/s. `stiffness` runs about `0.6` for deep-bodied fish
(angelfish, betta) and `1.1` for flexible ones (tetra, loach). The `s²` weighting keeps the head
straight and curves the rear, which is how fish actually turn.

**Banking.** Fish roll into turns, so a turning fish is seen more edge-on. In a flat side-on
renderer, approximate it by squashing perpendicular to the heading by up to ~38% in proportion to
angular velocity. It costs one transform and does more for the sense of a third dimension than any
amount of shading.

**Speed loss.** Sharp turns shed speed:
`targetSpeed = cruise · (1 − min(0.55, |headingError| · 0.5))`.
Without this, fish carve impossibly tight corners at full speed and the scene feels weightless.

For a proper C-start (startle response), see [Behaviour states](#behaviour-states) — it is a
separate, much more violent motion than a cruising turn.

## Burst and coast

Fish accelerate in pulses and glide between them. This is the single cheapest change that makes a
tank feel alive, and it's usually missing.

```
burstTimer -= dt
if (burstTimer <= 0) {
  burstTimer = random(burstEvery[0], burstEvery[1])
  speed = cruise · random(1.5, 2.2)
}
speed += (targetSpeed − speed) · min(1, drag · dt)
```

`drag` is an approach rate in units of 1/second (2–3 for small active fish, 1.2–1.5 for slow
deep-bodied ones). The `min(1, …)` clamp keeps it stable if a frame runs long.

Note the exponential approach rather than a fixed decrement — it gives the asymmetric
"shove then drift" profile that matches real swimming.

## Fin motion

- **Caudal** — hangs off the last vertebra, pointing backwards along `heading + π`. Because the
  last vertebra already carries the largest wave amplitude, the fin sweeps automatically. Attach
  its base at the *second-to-last* vertebra's ribs so it merges with the body rather than
  floating behind it. (Attaching at the last vertebra leaves a visible gap when the tail swings —
  confirmed by rendering it both ways.)
- **Pectoral** — a rounded blade at `s ≈ 0.22`, sculling at 2–5 Hz, the two sides driven **π out
  of phase**. Left and right in phase looks like flapping wings. Rate is independent of tail beat;
  when a fish hovers, pectorals speed up while the tail stops.
- **Dorsal** — a crest along `s ∈ [0.25, 0.6]` on `side = −1`, height following
  `sin(π·u^k)` so it peaks off-centre. Deform it with the spine; a rigid dorsal on a bending body
  is very visible.
- **Anal** — same generator as dorsal, `side = +1`, `s ∈ [0.55, 0.75]`, roughly half the height.
  Needed on angelfish, gouramis, and bettas; optional on small fish.
- **Ventral/pelvic** — small paired blades near `s ≈ 0.35`. Cheap detail, add only for hero fish.

Draw order matters: far-side pectoral → caudal → dorsal → anal → **body** → near-side pectoral →
eye. The body must occlude the far fin, or the fish looks flat.

## Steering

Accumulate every influence as a **vector**, sum, convert to a desired heading once, then
rate-limit the turn:

```
fx = cos(heading) · INERTIA          // 2.6 — dominant term, this is what holds a line
fy = sin(heading) · INERTIA
fx += cos(wanderDir) · wanderAmp     // wander target, see below
fy += sin(wanderDir) · wanderAmp
fx,fy += schooling vectors
fx,fy += wall vectors
desired = atan2(fy, fx)
heading += clamp(shortestAngle(desired − heading), ±turnRate·dt)
```

**Never blend in angle space.** Scaling a wrapped angle difference by a weight > 1 flips sign near
±π and launches creatures across the screen. This was observed directly: an angle-space version of
this model produced fish that exited the tank in perfectly straight lines, while the vector version
produced zero boundary violations over 40 simulated seconds.

**Wander must random-walk a world-space direction**, not a heading-relative offset:

```
wanderDir += gaussian() · wanderRate · sqrt(dt)
```

A heading-relative offset persists, and a persistent offset is a constant turn — the fish locks
into a circle. The measured straightness index (net displacement ÷ path length over 5-second
windows) was under 0.15 with the relative version and 0.50–0.69 with the world-space version.
Real cruising fish sit around 0.35–0.75, so use that band as your acceptance test.

`sqrt(dt)` rather than `dt` is deliberate: it keeps the random walk's variance frame-rate
independent, so the scene behaves the same at 60 and 120 Hz.

## Schooling

Reynolds' three rules, weighted so **separation dominates**. Fish overlapping is far more
noticeable than fish drifting apart.

```
separation   neighbours within ~0.7 body lengths   weight 2.0   (normalized, away from each)
alignment    neighbours within ~2.5 body lengths   weight 1.0   (mean heading unit vector)
cohesion     same radius                            weight 0.6   (unit vector toward centroid)
```

Multiply all three by a per-species `social` factor: `1.0` for tetras and rasboras, `0.3` for
guppies (loose association), `0` for bettas and most cichlids. Solitary fish with `social = 0`
should skip the neighbour loop entirely.

For under ~40 fish, the naive O(n²) loop is fine on the UI thread. Past that, bucket into a coarse
spatial grid or move the school to an Atlas tier where individual avoidance stops mattering.

Emergent milling (the school forming a slow torus) is realistic and worth keeping. If it becomes a
tight death-spiral, the cause is almost always cohesion outweighing inertia — lower cohesion
before touching anything else.

## Tank boundaries

Bouncing off walls is the giveaway of a fake aquarium. Fish turn *before* the glass and turn
*smoothly*.

```
margin ≈ 0.16 × min(width, height)
per-axis push = (margin − distance) / margin, only inside the margin
m = hypot(pushX, pushY)
force = normalize(push) · m³ · 14         // cubic ramp: gentle at the edge of the margin, firm at the glass
```

Also drag the wander target away from the wall, or the fish re-aims into the glass every frame and
grinds along it:

```
if (m > 0) wanderDir += shortestAngle(awayFromWall − wanderDir) · min(1, m²) · 3 · dt
```

Keep a hard positional clamp as a safety net, but treat it firing as a bug — with the constants
above it never triggered across 40 simulated seconds.

**Depth bands.** Give each species a preferred vertical band and a soft pull toward it:
`fy += clamp((bandY·H − y) / 120, ±1) · 1.4`. Surface dwellers ~0.25H, mid-water ~0.45H, bottom
dwellers ~0.88H. This alone makes a mixed tank read as a real community rather than a snow globe,
because the layers separate the way they do in a real aquarium.

## Behaviour states

A small state machine on top of steering adds a lot for little code. Each state overrides the
wander target and a couple of scalars:

| State | Trigger | Effect |
|---|---|---|
| `cruise` | default | as described above |
| `hover` | random, 2–6s, mostly bettas/angelfish/gouramis | speed → ~0.15 cruise, tail amplitude → 0.3×, pectoral rate → 2× |
| `feed` | user taps the surface | strong seek toward the tap point, cruise ×1.6, then `cruise` after ~6s |
| `startle` | tap near the fish | see C-start below |
| `graze` | bottom dwellers, random | speed → 0.3 cruise, band pull → substrate, brief pauses |

**C-start (startle).** Real fish escape with a distinct two-stage move: the body folds into a `C`
away from the threat over ~30 ms, then unfolds explosively. Approximate it as: for 0.1s set
`bend = ±1.6` (a large constant, not turn-driven) and speed to `4× cruise`, then release to
`cruise` over ~0.6s with `drag` temporarily halved. It costs a handful of lines and is by far the
most satisfying touch interaction in an aquarium.

## Tuned constants

Measured with the simulation described above; straightness index in the natural band and zero
boundary violations. Units: px/s, rad/s, seconds. Scale linearly with canvas size — these assume
roughly a 390×700 phone canvas.

| Species | cruise | turnRate | wanderRate | wanderAmp | social | drag | burstEvery | band |
|---|---|---|---|---|---|---|---|---|
| neon tetra | 44 | 2.6 | 0.9 | 1.0 | 1.0 | 2.5 | 0.5–1.4 | 0.45 |
| guppy | 30 | 2.0 | 1.1 | 1.2 | 0.3 | 2.0 | 0.7–2.0 | 0.35 |
| molly | 28 | 1.8 | 1.0 | 1.1 | 0.25 | 1.9 | 0.8–2.2 | 0.40 |
| betta | 17 | 1.1 | 1.0 | 1.4 | 0.0 | 1.4 | 1.6–4.0 | 0.35 |
| angelfish | 20 | 1.2 | 0.8 | 1.1 | 0.15 | 1.3 | 1.4–3.5 | 0.45 |
| goldfish | 26 | 1.5 | 0.9 | 1.1 | 0.2 | 1.6 | 1.0–2.6 | 0.50 |
| corydoras | 24 | 3.0 | 1.6 | 1.3 | 0.4 | 3.0 | 0.4–1.3 | 0.88 |
| kuhli loach | 30 | 3.4 | 1.8 | 1.4 | 0.2 | 3.2 | 0.5–1.6 | 0.92 |
| shrimp | 12 | 4.0 | 2.4 | 1.5 | 0.1 | 4.0 | 0.3–1.0 | 0.90 |
| snail | 1.6 | 0.5 | 0.25 | 0.6 | 0.0 | 6.0 | — | 0.95 |
| tadpole | 34 | 3.0 | 1.6 | 1.2 | 0.5 | 2.8 | 0.4–1.2 | 0.60 |

Randomize per individual at spawn: `cruise ×(0.9–1.1)`, `tailBeat ×(0.85–1.15)`,
`scale ×(0.9–1.1)`, plus a uniform random starting `phase` and `burstTimer`. Skipping this is the
most visible artificiality in the whole scene — identical fish moving in lockstep.
