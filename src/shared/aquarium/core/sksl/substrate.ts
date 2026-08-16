// The substrate was a flat two-stop gradient rect — "the least real-tank
// thing in the scene" per the aquarium guide. This shader keeps the same
// gradient as its base but adds static per-pixel grain (sand isn't a smooth
// surface) and a sparse scatter of darker grit specks, both procedural so
// this stays one draw call with no extra decor pieces or bake cost. No time
// uniform — sand doesn't move — so unlike `water.ts` this never needs to
// re-evaluate per frame; Skia can treat it as a static shader.
//
// Same module-level-singleton + warmup + null-fallback contract as
// `water.ts` — see that file for why.

import type { SkRuntimeEffect } from "@shopify/react-native-skia/src/skia/types";

import type { SkiaApi } from "../skia-types";

const SUBSTRATE_SOURCE = `
uniform float width;
uniform float height;
uniform float3 colorTop;
uniform float3 colorBottom;
uniform float3 speckleColor;
uniform float grainStrength;
uniform float speckleDensity;

float hash(float2 p) {
  return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453);
}

half4 main(float2 p) {
  float t = clamp(p.y / height, 0.0, 1.0);
  float3 base = mix(colorTop, colorBottom, t);

  // Per-pixel grain: a fine hashed jitter on luminance, the way sand's
  // countless individual grains catch light unevenly. Deliberately noisy at
  // pixel scale (not blurred cells like the speckles below) — a coarse grain
  // pattern reads as blotches, not texture.
  float grain = hash(p) - 0.5;
  base += grain * grainStrength;

  // Sparse darker grit / tiny pebbles: a coarse hashed cell grid, each cell
  // holding a soft dot at a random offset — same technique as water.ts's
  // dust motes, but static and much lower density.
  float2 cp = p * 0.18;
  float2 cell = floor(cp);
  float2 f = fract(cp);
  float h = hash(cell);
  if (h > (1.0 - speckleDensity)) {
    float2 c = float2(hash(cell + 4.1), hash(cell + 9.7));
    float d = distance(f, c);
    float speck = smoothstep(0.22, 0.0, d);
    base = mix(base, speckleColor, speck * 0.6);
  }

  return half4(clamp(base, 0.0, 1.0), 1.0);
}
`;

export const SUBSTRATE_UNIFORM_KEYS = [
  "width",
  "height",
  "colorTop",
  "colorBottom",
  "speckleColor",
  "grainStrength",
  "speckleDensity",
] as const;

let cachedEffect: SkRuntimeEffect | null | undefined;

export function getSubstrateEffect(Skia: SkiaApi): SkRuntimeEffect | null {
  if (cachedEffect !== undefined) return cachedEffect;
  const effect = Skia.RuntimeEffect.Make(SUBSTRATE_SOURCE);
  cachedEffect = effect ?? null;
  if (effect) warmUp(Skia, effect);
  return cachedEffect;
}

function warmUp(Skia: SkiaApi, effect: SkRuntimeEffect): void {
  const surface = Skia.Surface.Make(2, 2);
  if (!surface) return;
  const uniforms = {
    width: 2,
    height: 2,
    colorTop: [0, 0, 0],
    colorBottom: [0, 0, 0],
    speckleColor: [0, 0, 0],
    grainStrength: 0,
    speckleDensity: 0,
  };
  const shader = effect.makeShader(SUBSTRATE_UNIFORM_KEYS.flatMap((key) => uniforms[key]));
  const paint = Skia.Paint();
  paint.setShader(shader);
  surface.getCanvas().drawPaint(paint);
  surface.dispose();
}
