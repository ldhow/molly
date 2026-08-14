// The fish swim-bend shader: an SkSL RuntimeEffect that inverse-warps a baked
// fish texture through the SAME rigid normal-offset spine model as
// `fish/spine.ts`, THEN perturbs the result with up to three independent
// per-fin secondary rotations (pectoral near/far scull, caudal lag — see
// `fish/spine.ts`'s `finSecondaryOffset`). The two must never drift apart —
// `scripts/verify-aquarium.ts` renders a sampled grid through both and
// asserts sub-pixel agreement — so only the NUMERIC CONSTANTS (envelope
// shape, `SPINE_K`) are shared; the formula itself is written out twice on
// purpose (once as pure TS, once as SkSL) rather than string-templated,
// because a shared template can compile and still be wrong in a way neither
// language's typechecker catches.
//
// Fin secondary amplitudes (`pecNearAmp`/`pecFarAmp`/`caudalAmp`) arrive
// already time-resolved (ceiling * sin(phase [+ offset/- lag]), damped by
// speed) — computed once per frame in `render/fish-layer.tsx`'s
// `useDerivedValue`, not recomputed per-pixel here, since they don't vary
// with the sample position the way the base wave's `phase - k*u` does.
//
// One module-level effect (never one per fish — that's 25 SkSL compiles and
// 25 GPU program-cache entries), warmed with a 1x1 draw at creation so the
// first real frame isn't the one paying for shader compilation.

import {
  FilterMode,
  MipmapMode,
  TileMode,
  type SkRuntimeEffect,
} from "@shopify/react-native-skia/src/skia/types";

import { SPINE_K } from "@/shared/aquarium/fish/spine";

import type { SkiaApi } from "../skia-types";

// Keep in exact sync with fish/spine.ts's `envelope`/`envelopeD`/`ENVELOPE_DD`.
// `pecNearHub`/`pecFarHub`/`caudalHub` pack (hubX, hubN, radiusX, radiusN)
// per fin — keep in exact sync with fish/spine.ts's `finSecondaryOffset`.
const WARP_SOURCE = `
uniform shader src;
uniform float boundsX;
uniform float boundsWidth;
uniform float ampScale;
uniform float k;
uniform float phase;
uniform float bendAmp;
uniform float4 pecNearHub;
uniform float4 pecFarHub;
uniform float4 caudalHub;
uniform float pecNearAmp;
uniform float pecFarAmp;
uniform float caudalAmp;

float3 spineAt(float x) {
  float u = (x - boundsX) / boundsWidth;
  float invBw = 1.0 / boundsWidth;
  float env = 0.08 + 0.92 * u * u;
  float envD = 1.84 * u;
  const float envDD = 1.84;
  float A = ampScale * env;
  float Ad = ampScale * envD;
  float Add = ampScale * envDD;
  float angle = phase - k * u;
  float s = sin(angle);
  float c = cos(angle);
  float d = A * s + bendAmp * u * u;
  float dgdu = Ad * s - k * A * c + bendAmp * 2.0 * u;
  float d2gdu2 = Add * s - 2.0 * k * Ad * c - k * k * A * s + bendAmp * 2.0;
  return float3(d, dgdu * invBw, d2gdu2 * invBw * invBw);
}

// Rotates p by amp radians around hub.xy, eased to identity past the
// falloff ellipse hub.zw — the SkSL twin of finSecondaryOffset. edge0 >
// edge1 smoothstep is undefined by the GLSL/SkSL spec, so this is written
// out by hand (matching fish/spine.ts's manual version) rather than calling
// the built-in smoothstep(1.0, 0.0, dist).
float2 finOffset(float2 p, float4 hub, float amp) {
  float2 d = p - hub.xy;
  float dist = length(d / hub.zw);
  float t = clamp(1.0 - dist, 0.0, 1.0);
  t = t * t * (3.0 - 2.0 * t);
  float theta = amp * t;
  float c = cos(theta);
  float s = sin(theta);
  return hub.xy + float2(d.x * c - d.y * s, d.x * s + d.y * c);
}

half4 main(float2 p) {
  float qx = p.x;
  float qy = p.y;
  float x = qx;
  {
    float3 sp = spineAt(x);
    float dy = qy - sp.x;
    float g = (qx - x) + sp.y * dy;
    float gp = -1.0 - sp.y * sp.y + sp.z * dy;
    x = x - g / gp;
  }
  {
    float3 sp = spineAt(x);
    float dy = qy - sp.x;
    float g = (qx - x) + sp.y * dy;
    float gp = -1.0 - sp.y * sp.y + sp.z * dy;
    x = x - g / gp;
  }
  float3 spFinal = spineAt(x);
  float dy = qy - spFinal.x;
  float norm = 1.0 / sqrt(1.0 + spFinal.y * spFinal.y);
  float n = (dy - spFinal.y * (qx - x)) * norm;

  float2 warped = float2(x, n);
  warped = finOffset(warped, pecNearHub, pecNearAmp);
  warped = finOffset(warped, pecFarHub, pecFarAmp);
  warped = finOffset(warped, caudalHub, caudalAmp);

  return src.eval(warped);
}
`;

/** Declared uniform order in `WARP_SOURCE`, minus the `src` child shader. */
export const WARP_UNIFORM_KEYS = [
  "boundsX",
  "boundsWidth",
  "ampScale",
  "k",
  "phase",
  "bendAmp",
  "pecNearHub",
  "pecFarHub",
  "caudalHub",
  "pecNearAmp",
  "pecFarAmp",
  "caudalAmp",
] as const;

export { SPINE_K as WARP_K };

let cachedEffect: SkRuntimeEffect | null | undefined;

/**
 * Lazily compiles and caches the warp effect, with a one-time warmup draw so
 * the GPU program-cache cost lands here instead of on the first fish frame.
 * Returns null if the runtime refuses to compile it — callers must fall back
 * to the rigid `<Image>` path, mirroring `fish-picture.ts`'s
 * `FISH_RENDER_MODE` degradation contract.
 */
export function getWarpEffect(Skia: SkiaApi): SkRuntimeEffect | null {
  if (cachedEffect !== undefined) return cachedEffect;
  const effect = Skia.RuntimeEffect.Make(WARP_SOURCE);
  cachedEffect = effect ?? null;
  if (effect) warmUp(Skia, effect);
  return cachedEffect;
}

/** Exercises the full compile path once: a real child shader, a real draw. */
function warmUp(Skia: SkiaApi, effect: SkRuntimeEffect): void {
  const childSurface = Skia.Surface.Make(2, 2);
  const outSurface = Skia.Surface.Make(2, 2);
  if (!childSurface || !outSurface) return;
  childSurface.getCanvas().clear(Skia.Color("#ffffffff"));
  const childImage = childSurface.makeImageSnapshot();
  const childShader = childImage.makeShaderOptions(
    TileMode.Decal,
    TileMode.Decal,
    FilterMode.Linear,
    MipmapMode.None,
  );
  // `makeShaderWithChildren` (unlike the `<Shader uniforms={...}>` component
  // path in fish-layer.tsx) wants a pre-flattened `number[]`, so the float4
  // hub uniforms are 4-tuples here and `flatMap` inlines them — a degenerate
  // (zero-radius-safe) placeholder is fine since this is only a warmup draw.
  const uniforms: Record<(typeof WARP_UNIFORM_KEYS)[number], number | number[]> = {
    boundsX: -1,
    boundsWidth: 2,
    ampScale: 0,
    k: SPINE_K,
    phase: 0,
    bendAmp: 0,
    pecNearHub: [0, 0, 1, 1],
    pecFarHub: [0, 0, 1, 1],
    caudalHub: [0, 0, 1, 1],
    pecNearAmp: 0,
    pecFarAmp: 0,
    caudalAmp: 0,
  };
  const shader = effect.makeShaderWithChildren(
    WARP_UNIFORM_KEYS.flatMap((key) => uniforms[key]),
    [childShader],
  );
  const paint = Skia.Paint();
  paint.setShader(shader);
  outSurface.getCanvas().drawPaint(paint);
  childSurface.dispose();
  outSurface.dispose();
}
