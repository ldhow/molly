# The tank: everything that isn't a fish

A technically perfect fish in an empty blue rectangle looks worse than a crude fish in a
well-composed tank. Budget real effort here.

## Layer order

Back to front. Each layer is a `<Group>`; the whole scene is one `<Canvas>`.

1. **Water gradient** — vertical `LinearGradient`, lighter at the surface.
2. **Far background** — blurred plants and rocks at 40% opacity, desaturated.
3. **Caustics** — animated light bands (see below).
4. **Mid plants and hardscape**.
5. **Background fish** — smaller, desaturated, slightly blurred.
6. **Foreground fish** — full size and saturation.
7. **Bubbles**.
8. **Near plants** — a few leaves crossing in front, full opacity. This is what creates depth.
9. **Glass** — a soft vignette plus a single diagonal highlight streak.

## Water and light

```tsx
<Fill><LinearGradient start={vec(0,0)} end={vec(0,H)}
  colors={["#1E6F8E", "#134F6B", "#0A2E42"]} positions={[0, 0.55, 1]} /></Fill>
```

Deeper is darker and more saturated. Add a soft radial "sun" near the top:
`<RadialGradient c={vec(W*0.35, -40)} r={H*0.7} colors={["#7FD4E855", "#7FD4E800"]} />`.

**Caustics** — the rippling light net on the substrate — are the highest-value effect in the scene.
A runtime shader is the cheap way:

```tsx
const caustics = Skia.RuntimeEffect.Make(`
uniform float t; uniform vec2 res;
half4 main(vec2 pos) {
  vec2 uv = pos / res;
  float d = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i) + 1.0;
    d += sin(uv.x * 9.0 * fi + t * 0.6 * fi) * cos(uv.y * 7.0 * fi - t * 0.4 * fi);
  }
  float band = smoothstep(0.55, 1.4, abs(d));
  float fade = smoothstep(1.0, 0.25, uv.y);        // strongest near the surface
  return half4(vec3(0.72, 0.92, 1.0) * band * fade * 0.30, band * fade * 0.30);
}`)!;

const t = useClock();
const uniforms = useDerivedValue(() => ({ t: t.value / 1000, res: [W, H] }));
<Fill><Shader source={caustics} uniforms={uniforms} /></Fill>
```

Three octaves is enough; more just costs fill rate. Keep the alpha low (0.25–0.35) — caustics that
read clearly as an effect are too strong.

If a runtime shader isn't available, approximate with 5–7 wide, very transparent white `Path`
ribbons drifting horizontally at different speeds, each with `<Blur blur={8} />`.

## Plants

Build each plant once as a stem path and sway it with a transform rather than rebuilding geometry:

```
sway(u, t) = amplitude · u² · sin(t · rate + phase)      // u = 0 at base, 1 at tip
```

The `u²` weighting anchors the base and lets the tip travel — the same principle as fish
undulation. Use 0.4–0.8 Hz and give every plant its own phase.

Better still, drive plant sway from the same "current" value the fish see, so the whole scene
breathes together. A single slow shared value (`current = sin(t·0.15) · 0.4`) added to both plant
sway and fish `wanderDir` makes the tank feel like one body of water.

Types worth having: tall grass ribbons (3–5 blades from one base), a broad-leaf plant
(Bézier leaves radiating from a crown), and a foreground silhouette leaf at 90% opacity.

## Substrate and hardscape

- Gravel: 200–400 small ellipses generated once with a seeded random, sizes 2–6px, colours sampled
  from a 3-colour palette. `useMemo` this and never touch it again.
- Rocks and driftwood: irregular polygons smoothed with Catmull-Rom, dark and low-saturation. They
  should read as silhouette, not detail.
- A subtle darkening gradient over the bottom 15% grounds everything.

## Bubbles

Cheap and disproportionately effective.

- Spawn from one or two fixed points at 2–5 per second, or from an ornament.
- Rise at 40–90 px/s, faster as they rise (they expand and accelerate), with a lateral wobble of
  `sin(t·3 + phase) · 4px`.
- Radius 1.5–5px, drawn as a ring: a stroked circle at 45% white alpha plus a small offset
  highlight dot. A filled white circle looks like a bullet hole.
- Pop at the surface — scale to 1.4× and fade out over 120ms.
- Fish should occasionally emit a single small bubble; it draws the eye to them.

## Depth

Three tricks, cheap and worth all of them:

- **Scale** — background creatures at 0.6–0.75×.
- **Desaturation and haze** — composite background fish with a `<Group opacity={0.7}>` over a
  slight blue overlay; distance in water means colour loss.
- **Parallax** — offset layers by device tilt (`expo-sensors`) or by scroll position. Background at
  0.25× the offset, foreground at 1.4×. Even ±8px of movement makes the tank feel like a volume.

Assign each creature a `z ∈ [0, 1]` at spawn and derive scale, opacity, blur and parallax from it
with a single function. Fish may drift slowly in `z`, passing behind and in front of plants.

## Keep creatures out of the UI

Pass the app's header and tab-bar heights to the steering layer as insets and treat them as walls.
Fish drifting under a button bar is invisible in a bare demo and glaringly obvious the moment the
scene sits behind real UI. Depth bands should be computed inside the inset region too, or a
bottom-dweller will sit permanently behind the tab bar.

## Interaction

- **Tap to feed** — spawn 5–8 flakes at the tap point that sink at ~25 px/s with lateral drift.
  Fish within ~200px switch to the `feed` state and seek the nearest flake; a flake is consumed on
  contact. Fish that reach the surface should turn horizontal briefly. This is the interaction users
  expect and the one that best shows off the steering model.
- **Tap near a fish** — trigger the C-start startle (see `motion.md`). The scattering school is the
  most impressive single moment in an aquarium app.
- **Drag** — create a current: a vector field pushing creatures along the drag direction, decaying
  over ~1.5s.
- **Long press on a fish** — surface a detail card. Hit-testing is `SkPath.contains(x, y)` on the
  body path, or just a distance check against the spine's midpoint (cheaper and accurate enough).

Wire gestures with `react-native-gesture-handler`'s `GestureDetector` wrapping the `<Canvas>`, and
write the touch point straight into a shared value so the reaction happens on the UI thread.

## Ambience

- Vary tail-beat and wander slightly with a slow global "time of day" value; fish should be calmer
  at night, and the water gradient can shift cooler.
- Keep at least one creature doing something unusual at any moment — a cory darting to the surface,
  a snail turning around. Perfectly uniform behaviour across the tank reads as a screensaver.
- Resist adding more fish to make the scene interesting. Six well-animated fish in a deep,
  well-lit tank beat twenty flat ones.
