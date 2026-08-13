// Fullscreen water pass: a depth gradient plus a soft animated caustic
// shimmer and a few drifting god-ray shafts — replaces Phase 1's flat
// gradient rect. One shader, no child image (this paints procedurally, it
// doesn't sample anything), so it's cheap: one draw call covering the whole
// canvas regardless of fish/decor count.
//
// Same module-level-singleton + warmup + null-fallback contract as
// `warp.ts` — see that file for why.

import type { SkRuntimeEffect } from "@shopify/react-native-skia/src/skia/types";

import type { SkiaApi } from "../skia-types";

const WATER_SOURCE = `
uniform float width;
uniform float height;
uniform float time;
uniform float3 colorTop;
uniform float3 colorMid;
uniform float3 colorBottom;

half4 main(float2 p) {
  float t = clamp(p.y / height, 0.0, 1.0);
  float3 base = t < 0.55
    ? mix(colorTop, colorMid, t / 0.55)
    : mix(colorMid, colorBottom, (t - 0.55) / 0.45);

  // A warmer top-to-bottom grade — real sunlit water reads warmer near the
  // surface (t=0) and cools toward blue with depth. A small additive tint,
  // not a recolor, so colorTop/colorMid/colorBottom stay the source of
  // truth for the theme's actual palette.
  float3 warmTint = float3(0.06, 0.03, -0.02);
  base += warmTint * (1.0 - t) * (1.0 - t);

  // Soft caustic shimmer: two offset sine fields — strengthened from the
  // Phase 1 baseline (Pondlife painterly pass) so it reads as light actually
  // moving through the water, not a barely-there flicker.
  float shimmer = sin(p.x * 0.045 + time * 0.55) * sin(p.y * 0.035 - time * 0.4);
  base += shimmer * 0.03;

  // God-ray shafts. Each is a soft band leaning with depth, and each drifts
  // horizontally on its own slow phase so the set never reads as a static
  // striped overlay. Strengthened toward the reference's prominent vertical
  // light: five shafts of varying width instead of three identical ones,
  // brighter near the surface and fading with depth (real shafts scatter
  // out). Still smoothstep-soft — a hard-edged beam looks like a bug.
  float ray = 0.0;
  ray += smoothstep(70.0, 0.0, abs(p.x - width * 0.14 - p.y * 0.13 + sin(time * 0.11) * 16.0)) * 0.9;
  ray += smoothstep(44.0, 0.0, abs(p.x - width * 0.33 - p.y * 0.10 + sin(time * 0.17 + 1.7) * 12.0)) * 0.7;
  ray += smoothstep(80.0, 0.0, abs(p.x - width * 0.53 - p.y * 0.14 + sin(time * 0.09 + 3.1) * 20.0)) * 1.0;
  ray += smoothstep(40.0, 0.0, abs(p.x - width * 0.72 - p.y * 0.11 + sin(time * 0.15 + 4.4) * 13.0)) * 0.65;
  ray += smoothstep(64.0, 0.0, abs(p.x - width * 0.89 - p.y * 0.13 + sin(time * 0.13 + 5.6) * 17.0)) * 0.85;
  float rayFade = smoothstep(1.0, 0.12, t);   // strongest at the surface
  base += ray * 0.17 * rayFade;

  // Suspended dust motes, concentrated inside the shafts (that's the only
  // place you'd actually see them — a mote is visible because light catches
  // it). Procedural in-shader: a hashed cell grid drifting slowly upward,
  // so this costs no extra draw call and no particle bookkeeping, unlike
  // render/bubbles.tsx's <Atlas> pass which stays for the real bubbles.
  vec2 mp = vec2(p.x * 0.045, p.y * 0.045 + time * 0.06);
  vec2 cell = floor(mp);
  vec2 f2 = fract(mp);
  float h = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
  float h2 = fract(sin(dot(cell, vec2(269.5, 183.3))) * 43758.5453);
  // Only ~18% of cells hold a mote, else the water looks like static.
  if (h > 0.82) {
    vec2 c = vec2(h2, fract(h * 7.0));
    float d = distance(f2, c);
    float mote = smoothstep(0.13, 0.0, d);
    // Twinkle, and only where a shaft actually lights it.
    float tw = 0.55 + 0.45 * sin(time * 1.7 + h * 40.0);
    base += vec3(0.85, 0.94, 1.0) * mote * tw * min(ray, 1.0) * 0.55 * rayFade;
  }

  return half4(clamp(base, 0.0, 1.0), 1.0);
}
`;

export const WATER_UNIFORM_KEYS = [
  "width",
  "height",
  "time",
  "colorTop",
  "colorMid",
  "colorBottom",
] as const;

let cachedEffect: SkRuntimeEffect | null | undefined;

export function getWaterEffect(Skia: SkiaApi): SkRuntimeEffect | null {
  if (cachedEffect !== undefined) return cachedEffect;
  const effect = Skia.RuntimeEffect.Make(WATER_SOURCE);
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
    time: 0,
    colorTop: [0, 0, 0],
    colorMid: [0, 0, 0],
    colorBottom: [0, 0, 0],
  };
  const shader = effect.makeShader(WATER_UNIFORM_KEYS.flatMap((key) => uniforms[key]));
  const paint = Skia.Paint();
  paint.setShader(shader);
  surface.getCanvas().drawPaint(paint);
  surface.dispose();
}
