# Species: shapes and what makes each one recognizable

A creature preset is one object holding **shape** (width profile, fins) and **motion** (from
`motion.md`). The silhouettes below were rendered and visually checked; the numbers are the ones
that produced recognizable fish, not guesses.

## Contents

- [How a preset is built](#how-a-preset-is-built)
- [Width profiles](#width-profiles)
- [Fish presets](#fish-presets)
- [Reading the fins](#reading-the-fins)
- [Non-fish: snail, shrimp, tadpole, frog](#non-fish-snail-shrimp-tadpole-frog)
- [Colour and pattern](#colour-and-pattern)
- [Inventing a new species](#inventing-a-new-species)

## How a preset is built

```ts
{
  length: 68,                    // px, nose to tail base (fins extend past this)
  segments: 12,                  // vertebrae; 10-12 is plenty, 16+ for eels
  widths: [...],                 // 10 half-widths as a fraction of length, nose -> tail
  wavelength: 1.0,               // body lengths per wave
  tailBeat: 2.0,                 // Hz at cruise speed
  envelope: [0.02, -0.0825, 0.1625],   // a0 + a1·s + a2·s²
  turnStiffness: 0.8,
  caudal:   { type: 'fan', length: 0.22, spread: 0.52 },
  dorsal:   { span: [0.26, 0.58], height: 0.17, peak: 0.4 },
  anal:     { span: [0.58, 0.76], height: 0.09, peak: 0.5 },   // optional
  pectoral: { at: 0.24, length: 0.15, rate: 2.6, sweep: 0.30 },
  body: '#2E2E38', fin: '#8A8FA3', belly: '#4A4A58',
}
```

Fin lengths and dorsal heights are **fractions of body length**, so a preset scales cleanly.

## Width profiles

Half-width as a fraction of body length, sampled evenly from nose to tail. The shape of this
array *is* the fish — get it right before touching anything else.

```
torpedo (tetra, danio)   [0.048, 0.095, 0.112, 0.110, 0.098, 0.080, 0.060, 0.042, 0.028, 0.020]
slim   (guppy)           [0.050, 0.088, 0.100, 0.096, 0.086, 0.072, 0.058, 0.043, 0.030, 0.022]
stocky (molly, platy)    [0.058, 0.125, 0.155, 0.160, 0.148, 0.124, 0.096, 0.068, 0.046, 0.030]
deep   (betta)           [0.060, 0.120, 0.145, 0.150, 0.140, 0.120, 0.095, 0.070, 0.050, 0.034]
disc   (angelfish)       [0.070, 0.170, 0.215, 0.220, 0.200, 0.165, 0.120, 0.080, 0.052, 0.032]
round  (goldfish)        [0.075, 0.155, 0.190, 0.195, 0.180, 0.150, 0.110, 0.070, 0.045, 0.028]
flat   (corydoras)       [0.075, 0.135, 0.150, 0.140, 0.120, 0.098, 0.072, 0.050, 0.034, 0.024]
ribbon (kuhli, eel)      [0.030, 0.048, 0.052, 0.052, 0.050, 0.048, 0.044, 0.038, 0.028, 0.016]
```

Two rules that matter more than the exact numbers:

- **Peak width sits at `s ≈ 0.3`**, never at the midpoint. A fish widest in the middle looks like
  a leaf. The taper behind the peak should be long and smooth.
- **The tail base is thin but not zero** (`0.016–0.034`). Pinching it to zero creates a cusp that
  the Catmull-Rom smoothing turns into a visible spike when the tail swings.

## Fish presets

| Species | length | profile | wavelength | tailBeat | caudal | dorsal | notes |
|---|---|---|---|---|---|---|---|
| **guppy** | 52 | slim | 0.95 | 2.6 | `fan 0.30 / 0.60` | `[.35,.55] h.10` | Male: oversized bright caudal, plain body. Female: larger body, small clear fins. |
| **molly** | 68 | stocky | 1.00 | 2.0 | `fan 0.22 / 0.52` | `[.26,.58] h.17` | Sailfin variant: dorsal height 0.34, span `[.22,.62]`. Thicker than a guppy — that's the tell. |
| **betta** | 58 | deep | 1.15 | 1.5 | `veil 0.46 / 0.70` | `[.32,.72] h.26` | Hovers far more than it swims. Big anal fin `h.22`. Fins lag heavily (`0.85`). |
| **neon tetra** | 38 | torpedo | 0.90 | 3.2 | `fork 0.20 / 0.50` | `[.36,.52] h.09` | Tiny, fast, schools hard. Stripe is the whole identity — see colour below. |
| **angelfish** | 64 | disc | 1.30 | 1.2 | `lyre 0.34 / 0.62` | `[.16,.60] h.42 peak.35` | Needs the matching anal fin `h.40` or it looks half-drawn. Long trailing ventrals. |
| **goldfish** | 72 | round | 1.10 | 1.6 | `veil 0.38 / 0.72` | `[.24,.56] h.20` | Fancy variants: shorten length to 52, widen profile, double the caudal. |
| **corydoras** | 50 | flat | 1.10 | 2.2 | `fork 0.20 / 0.46` | `[.25,.42] h.26` | Flat belly, tall triangular dorsal, busy pectorals (`rate 5.0`). Bottom band. |
| **kuhli loach** | 90 | ribbon | 0.60 | 2.4 | `fan 0.10 / 0.40` | none | Anguilliform envelope `[0.05, 0.15, 0]`, 18 segments. Bands, not stripes. |
| **zebra danio** | 40 | torpedo | 0.90 | 3.4 | `fork 0.22 / 0.52` | `[.40,.56] h.10` | Like a tetra but faster and less tightly schooling. |

The `caudal` shorthand is `type length / spread` where length is a fraction of body length and
spread is the half-angle in radians.

## Reading the fins

The caudal fin type carries most of the species read at small sizes:

- `fork` — notch at 45% of fin length. Fast open-water fish. Tetra, danio, cory.
- `fan` — rounded, notch at 92% (barely concave). Livebearers: guppy, molly, platy.
- `veil` — long, lower lobe extended 15% further, notch 75%. Betta, fancy goldfish. Give these a
  higher `lag` so the fin trails visibly behind the peduncle — that flowing delay is the point.
- `lyre` — deep notch at 30%, both lobes trailing. Angelfish, swordtail.

If the fish must read below ~40px, drop the anal and ventral fins entirely and exaggerate the
caudal by 20%. Detail that can't be resolved just muddies the silhouette.

## Non-fish: snail, shrimp, tadpole, frog

These need **different locomotion models**, not a fish with different widths. Using the fish spine
for a snail is the most common mistake here.

### Snail

Snails glide on a muscular foot using **pedal waves** — bands of contraction travelling front-to-back
along the sole — at roughly 1.3 cm/min. They do not undulate, bank, or turn quickly.

- **Body**: static shell path (a logarithmic spiral, 2.5–3 turns) sitting on a soft foot path.
  The shell never deforms; only the foot does.
- **Foot**: a flat rounded shape whose *lower edge* carries 3–4 travelling ripples:
  `yOffset(u) = 1.5 · sin(2π·(3u − 0.6t))` px. Subtle — a few pixels — but it reads as crawling.
- **Motion**: constrain to surfaces (substrate, glass, plant stems). Speed ~1.6 px/s, turnRate 0.5.
  On the glass, treat the wall as a rail: position becomes a scalar along the perimeter.
- **Tentacles**: two upper (eye) and two lower stalks, each a 3-point Bézier that sways with a slow
  sine and *retracts* (length → 0.2×, over 150 ms) if a fish passes within ~30px. That retraction is
  the single most characterful detail available.
- **Trail**: optional faded mucus line behind it, alpha 0.06, fading over ~8s.

### Shrimp

- Segmented rigid body — a chain of 6 overlapping rounded plates, not a smooth outline. Bend the
  chain, don't extrude a skin.
- **Two gaits**: (a) grazing — near-stationary, 8 tiny swimmeret paddles beating in a metachronal
  wave (each 20° out of phase with its neighbour, back to front); (b) escape — a tail-flip that
  fires the shrimp *backwards* at ~10× speed for ~250 ms, body curling to ~90°. The backward escape
  is instantly recognizable.
- Antennae: two long thin lines, twice body length, trailing with heavy lag.
- Nearly transparent: body alpha ~0.55 with a slightly opaque gut line.

### Tadpole

- Pure **anguilliform**: envelope `[0.05, 0.15, 0]`, wavelength 0.55, tailBeat 4–6 Hz. Very fast,
  small amplitude, constant motion.
- Shape is a large round head (widths `[0.16, 0.19, 0.16, 0.12, 0.09, 0.07, 0.05, 0.035, 0.025, 0.015]`)
  with a translucent fin membrane above and below the tail — draw the membrane as a second, wider
  outline at 40% alpha behind the body.
- Growth is a nice touch: interpolate the width profile toward froglet over time and fade in legs.

### Frog

Frogs **kick and glide** — nothing continuous about it. The cycle is roughly 1.2s:

1. `0.00–0.15s` — legs fold in (fast, ease-in).
2. `0.15–0.35s` — explosive extension, speed spikes to ~5× glide speed.
3. `0.35–1.20s` — legs held straight back, body rigid, decelerating glide.

Model the frog as a static body path plus two 3-segment leg chains (hip → knee → ankle → foot)
driven by that timeline; front legs mostly tuck. Webbed feet spread during the power stroke and
fold on the recovery — animate foot spread with the same curve as the kick, and the swim reads
correctly even if everything else is crude. Frogs also surface periodically: pull toward `y ≈ 0.1H`,
pause 2–4s with only the eyes above the waterline, then dive.

## Colour and pattern

Flat fills read better than gradients at small sizes, but three cheap touches lift everything:

- **Belly counter-shading** — a second outline built from the same spine but only the `+1` side,
  offset inward ~35%, filled 12% lighter. Costs one extra path, adds a lot of form.
- **Stripes and bands** — build them in body-local space and deform them with the same spine, or
  they will slide over the fish as it bends. A neon tetra's stripe is just a 4px-wide path along
  `s ∈ [0.15, 0.85]` at a constant lateral offset.
- **Iridescence** — a `<LinearGradient>` clipped to the body path, animated slowly with the fish's
  heading, sells "wet" better than any amount of shading.

Keep species palettes distinct in *value*, not just hue — at thumbnail size a tank of equally
mid-toned fish turns to mush.

## Inventing a new species

When the user asks for something not listed:

1. Pick the closest width profile and scale it — deeper body means multiply the middle entries.
2. Pick the swimming mode from body shape: long and thin → anguilliform; deep and round →
   subcarangiform with a low tailBeat; streamlined → carangiform, high tailBeat.
3. Set `tailBeat` inversely to length. Small fish beat fast (3–4 Hz), big ones slow (1–1.5 Hz).
4. Choose the caudal type from the four above; it does most of the identification work.
5. Only then pick colours.
