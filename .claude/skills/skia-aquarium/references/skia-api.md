# React Native Skia + Reanimated: the parts you need

Covers the API surface this skill uses, the version differences, and the failure modes that cost
the most time.

## Contents

- [Version compatibility](#version-compatibility)
- [Reanimated integration](#reanimated-integration)
- [The animation loop](#the-animation-loop)
- [Building paths](#building-paths)
- [Shared-value patterns that actually re-render](#shared-value-patterns-that-actually-re-render)
- [Worklet rules](#worklet-rules)
- [Drawing primitives](#drawing-primitives)
- [Atlas for large schools](#atlas-for-large-schools)
- [Performance checklist](#performance-checklist)

## Version compatibility

```bash
npx expo install @shopify/react-native-skia react-native-reanimated
```

- Skia **2.10+** requires Reanimated **4+**. Older Skia works with Reanimated 3.
- Skia 2.x introduced the **immutable path API**. Both forms appear in the wild:

| Task | Skia 2.x (current) | Legacy |
|---|---|---|
| Build | `Skia.PathBuilder.Make()…build()` | `Skia.Path.Make()` (mutable) |
| Circle | `Skia.Path.Circle(x, y, r)` | `path.addCircle(x, y, r)` |
| Transform | `const p2 = p.transform(m)` (returns new) | `p.transform(m)` (mutates) |
| Stroke | `Skia.Path.Stroke(p, opts)` | `p.stroke(opts)` |
| Interpolate | `Skia.Path.Interpolate(a, b, t)` | `a.interpolate(b, t)` |

Static operations return `SkPath | null` — handle the null (`?? path`) rather than asserting.

`assets/fishMath.ts` exports `newPathBuilder()` / `finishPath(b)` which pick the right form at
runtime. Use them so the code survives an upgrade.

## Reanimated integration

Skia consumes Reanimated shared values **directly as props**. There is no
`createAnimatedComponent` and no `useAnimatedProps`:

```tsx
const r = useSharedValue(0);
const c = useDerivedValue(() => 256 - r.value);
<Circle cx={r} cy={c} r={20} color="cyan" />   // pass the object, not .value
```

Passing `r.value` instead of `r` silently freezes the animation — the component gets a number once
and never updates. This is the most common Skia+Reanimated bug.

**Colours are different.** Skia stores colour differently from Reanimated, so Reanimated's
`interpolateColor` does not work. Use `interpolateColors` from `@shopify/react-native-skia`.

## The animation loop

Two options, and the choice matters:

**`useClock()`** (Skia) — a shared value of milliseconds since mount. Good for pure functions of
time: a shader uniform, a rotating decoration.

```tsx
const t = useClock();
const transform = useDerivedValue(() => [{ rotate: t.value / 1000 }]);
```

**`useFrameCallback()`** (Reanimated) — gives you `dt` and lets you integrate state. **This is what
a simulation needs.** Steering, burst-and-coast and phase accumulation are all stateful; they
cannot be expressed as `f(t)`.

```tsx
useFrameCallback((info) => {
  "worklet";
  const dt = Math.min(0.05, (info.timeSincePreviousFrame ?? 16) / 1000);  // clamp!
  stepSimulation(state, dt);
  frame.value = frame.value + 1;
});
```

Always clamp `dt`. The first frame reports `null`, and a backgrounded app returns a huge delta that
teleports every creature through the tank walls on resume.

## Building paths

For a deforming body you rebuild the path each frame inside a `useDerivedValue`:

```tsx
const body = useDerivedValue(() => {
  "worklet";
  frame.value;                      // subscribe to the tick
  return buildFishPath(state, index, spec);
});
<Path path={body} color={spec.body} />
```

Skia also offers `usePathValue(build, initial, transform)` which avoids some allocation, and
`usePathInterpolation(progress, inputRange, paths)` for morphing between fixed shapes (the paths
must have identical command counts). `usePathInterpolation` is the right tool for a discrete state
change — mouth open/closed, fin spread on a startle — but not for continuous undulation.

Per-frame path construction for a dozen fish is fine. It stops being fine somewhere around 25–30;
at that point move background fish to a rigged or atlas tier.

## Shared-value patterns that actually re-render

Reanimated detects changes by assignment, not by mutation. Mutating an array or object held in a
shared value does **not** notify dependents. Three workable patterns:

**1. Typed array + tick counter (recommended for simulations).** Store all creature state in one
`Float32Array`, mutate it in place for zero allocation, and bump a separate counter that derived
values read:

```tsx
const state = useSharedValue(new Float32Array(count * STRIDE));
const frame = useSharedValue(0);
// in useFrameCallback: mutate state.value in place, then frame.value += 1
// in useDerivedValue:  read frame.value first, then read state.value
```

The bare `frame.value;` statement at the top of the derived value is load-bearing — it is what
registers the dependency. Add a comment saying so or someone will delete it.

**2. New object per creature per frame.** `fish.value = { ...next }`. Simple, allocates, fine for
under ~20 creatures.

**3. Scalar shared values.** One per animated property. Verbose but bulletproof; good for a single
hero fish.

## Worklet rules

Everything running on the UI thread needs `"worklet";` as the **first statement** in the function
body — including every helper it calls.

- Only worklet-safe values may be captured. `Math.*` is fine. Closures over plain JS objects are
  captured by value at creation, so they will not see later updates — pass changing data through
  shared values.
- No `console.log` in hot paths (it hops threads and tanks the frame rate). To debug, write a
  value into a shared value and render it as text, or use `runOnJS` sparingly outside the loop.
- Arrow functions defined inside a worklet are automatically workletized in Reanimated 3+, but
  module-level helpers are not — mark them explicitly.
- `Math.random()` is safe in worklets. Seeded, reproducible noise needs your own hash function
  (a small `sin`-based hash is plenty for jitter).

## Drawing primitives

```tsx
import { Canvas, Group, Path, Circle, Oval, Fill, LinearGradient,
         RadialGradient, Blur, BlurMask, Shadow, Skia, vec } from "@shopify/react-native-skia";
```

- `<Group transform={[{translateX}, {rotate}, {scale}]} origin={vec(x, y)}>` — transforms nest, so
  a head→body→tail group chain gives you a skeleton for free (the rigged tier).
- `<Path path={p} style="fill" />` — `style="stroke"` plus `strokeWidth`/`strokeJoin` for outlines.
  `start`/`end` props trim a path to a fraction, useful for growing plants.
- `fillType="evenOdd"` when a shape self-intersects — a bending body with wide fins can overlap
  itself, and winding fill will show artefacts.
- Paint properties can also be children: `<Path path={p}><LinearGradient …/></Path>`.
- `<Blur blur={n} />` inside a `<Group>` blurs everything in it — the cheapest depth-of-field for
  background fish.

## Atlas for large schools

`<Atlas>` draws N sprites from one texture in a single call.

```tsx
const sprites = useRectBuffer(N, (rect, i) => { "worklet"; rect.setXYWH(0, 0, 64, 32); });
const transforms = useRSXformBuffer(N, (val, i) => {
  "worklet";
  frame.value;
  const a = state.value[i * STRIDE + 2];
  const s = 0.8;
  val.set(Math.cos(a) * s, Math.sin(a) * s, state.value[i * STRIDE], state.value[i * STRIDE + 1]);
});
<Atlas image={texture} sprites={sprites} transforms={transforms} />
```

An RSXform is `(scos, ssin, tx, ty)` — rotation and uniform scale only, no shear. Generate the
texture with `useTexture` / `createPicture` from a Skia drawing of one fish at a few tail phases,
then index into the sprite frames by phase to fake undulation.

## Performance checklist

- One `<Canvas>` for the whole scene. Multiple canvases each carry their own surface and are the
  fastest way to lose 30 fps.
- Static geometry (plants, rocks, glass, gravel) built **once** with `useMemo`, never per frame.
  Wrap it in a `<Picture>` if it's complex.
- No allocation inside the frame callback: no array literals, no object spreads, no `.map`. Mutate
  preallocated buffers.
- Hoist per-species constants out of worklets; recomputing a width profile 60×/second per fish adds up.
- `<Blur>` and `<Shadow>` are expensive on Android. Use at most one blurred layer, and prefer a
  pre-blurred static background over a live filter.
- Runtime shaders (caustics) cost roughly a full-screen pass — one is fine, two is not.
- Test on a mid-range Android device, not the simulator. Skia's iOS performance is misleadingly good.
- If frames drop, profile in this order: number of deformed fish → blur/shader passes → allocations
  in the loop → path complexity (drop `segments` from 12 to 9 before anything else).
