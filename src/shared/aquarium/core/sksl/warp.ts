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
//
// SECOND JOB: dynamic relighting. After the warp resolves where to sample,
// this also samples `fish/normal-map.ts`'s body normal field at the SAME
// warped coordinate and re-lights the baked pixel from `core/shading.ts`'s
// `LIGHT_DIR`. That buys the two things a baked-in highlight can never do —
// it tracks the body as it bends (the normal is rotated by the spine slope
// this shader already solved for) and it changes with the fish's heading (the
// normal is rotated about the vertical axis by yaw). Both are pure per-pixel
// arithmetic on values the warp had computed anyway; the only new cost is one
// texture fetch from a map small enough that the whole app needs eight of
// them. With `DYNAMIC_RELIGHT`'s gains at zero every added term collapses and
// the output is byte-identical to the pre-relight shader — which is exactly
// what `scripts/verify-aquarium.ts` asserts, so the warp's own TS-vs-SkSL
// agreement check keeps working unchanged.

import {
  FilterMode,
  MipmapMode,
  TileMode,
  type SkRuntimeEffect,
} from "@shopify/react-native-skia/src/skia/types";

import { DYNAMIC_RELIGHT, LIGHT_DIR, RIM_TINT, SPECULAR_TINT, tintUnit } from "../shading";
import { SPINE_K } from "@/shared/aquarium/fish/spine";

import type { SkiaApi } from "../skia-types";

// Keep in exact sync with fish/spine.ts's `envelope`/`envelopeD`/`ENVELOPE_DD`.
// `pecNearHub`/`pecFarHub`/`caudalHub` pack (hubX, hubN, radiusX, radiusN)
// per fin — keep in exact sync with fish/spine.ts's `finSecondaryOffset`.
const WARP_SOURCE = `
uniform shader src;
uniform shader nrm;
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
uniform float3 lightDir;
uniform float3 specTint;
uniform float3 rimTint;
uniform float yawCos;
uniform float yawSin;
uniform float lightGain;
uniform float specGain;
uniform float specPower;
uniform float rimGain;
uniform float mirrorX;

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

  // ---- dynamic relight (see this file's header, and core/shading.ts's
  // DYNAMIC_RELIGHT). Sampled at the warped coordinate, so the lighting
  // travels with the bent body rather than with the screen.
  half4 nSample = nrm.eval(warped);
  // Outside the normal map's own rect the child is decal-tiled and returns
  // (0,0,0,0), so mask lands at 0 and every term below drops out — fins and
  // the padding around the body keep exactly their baked colour, which is
  // also the right answer for a thin translucent membrane.
  float mask = float(nSample.b) * float(nSample.a);

  float2 nxy = float2(nSample.rg) * 2.0 - 1.0;
  // z is not stored: the baked vector is unit length and faces the viewer,
  // so this recovers it exactly and frees the blue channel for the mask.
  float nz = sqrt(max(0.0, 1.0 - dot(nxy, nxy)));
  float3 bodyN = float3(nxy, nz);

  half4 albedo = src.eval(warped);

  // (1) Into the BENT body's frame. spFinal.y is the spine's slope at this
  // sample and norm its 1/sqrt(1+slope^2) — both already solved above, so
  // the lighting cannot drift from the curve the pixels were warped by.
  float cosT = norm;
  float sinT = spFinal.y * norm;
  bodyN = float3(bodyN.x * cosT - bodyN.y * sinT, bodyN.x * sinT + bodyN.y * cosT, bodyN.z);

  // (2) About the vertical axis by the heading. THIS is what a flat texture
  // never had: broadside the flank normal points at the viewer, edge-on it
  // points along x, so the same pixel is lit differently at every yaw. The
  // caller supplies cos/sin already corrected for the draw-time mirror —
  // see relightYaw() below.
  float3 v = float3(
    bodyN.x * yawCos + bodyN.z * yawSin,
    bodyN.y,
    -bodyN.x * yawSin + bodyN.z * yawCos
  );
  // (3) The DRAW-TIME MIRROR. Everything above is in the texture's own
  // space; the transform that draws it flips x whenever the animal faces
  // the other way (fish-layer.tsx's matrixW, the snail's crawl direction).
  // Light is fixed in SCREEN space, so the mirror has to be applied to the
  // normal too — without this a fish swimming right and one swimming left
  // carry their highlight on opposite sides of the same feature. Only x
  // flips: a mirror does not move the surface toward or away from the
  // viewer, so negating z here would invert the whole dome instead.
  v.x *= mirrorX;

  float3 L = normalize(lightDir);
  float ndl = dot(v, L);
  float3 H = normalize(L + float3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(v, H), 0.0), specPower);
  float fres = pow(1.0 - clamp(v.z, 0.0, 1.0), 3.0);

  // CENTRED ON THE FLAT CASE. A pixel whose surface has no curvature at all
  // — normal straight at the viewer — must come out unchanged. Without the
  // subtraction it does not: dot(+z, L) is 0.48 for the shared light, so
  // every flat pixel got +16% brighter for doing nothing, and the pass was
  // as much a uniform lift as it was modelling. That is precisely what
  // core/shading.ts says this must not do, because a lift washes out the
  // pigment each variety is tuned around. Subtracting the flat-surface
  // response makes it pure redistribution: curvature toward the light
  // brightens, curvature away darkens, a flat flank is left alone.
  //
  // Still exactly 1.0 when lightGain is 0, so the byte-identical identity
  // verify-aquarium.ts leans on is unaffected.
  float shade = 1.0 + lightGain * mask * (ndl - L.z);
  half3 rgb = albedo.rgb * half(shade);
  rgb += half3(specTint) * half(mask * specGain * spec) * albedo.a;
  rgb += half3(rimTint) * half(mask * rimGain * fres) * albedo.a;
  // Keep the result a valid premultiplied colour. Also a no-op at zero gain,
  // since a premultiplied source already satisfies rgb <= a.
  rgb = min(rgb, half3(albedo.a));
  return half4(rgb, albedo.a);
}
`;

/** Declared uniform order in `WARP_SOURCE`, minus the `src`/`nrm` child shaders. */
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
  "lightDir",
  "specTint",
  "rimTint",
  "yawCos",
  "yawSin",
  "lightGain",
  "specGain",
  "specPower",
  "rimGain",
  "mirrorX",
] as const;

/**
 * The relight uniforms that never vary per fish or per frame — the light
 * vector and the two tints, resolved once from `core/shading.ts` so the
 * shader and the painted bake cannot end up lighting from different places.
 * Spread this into the per-frame uniforms; the caller supplies `yawCos`/
 * `yawSin` (see `relightYaw`) and may zero any gain to opt out.
 */
/**
 * The three per-frame values that describe how the body is ORIENTED, as
 * opposed to how it is lit. Always produced together by `relightYaw` — a
 * caller that supplies one without the others gets a body lit for a pose it
 * is not in.
 */
export interface RelightPose {
  yawCos: number;
  yawSin: number;
  /** -1 when the draw transform mirrors x, +1 otherwise. */
  mirrorX: number;
}

export interface RelightUniforms {
  lightDir: number[];
  specTint: number[];
  rimTint: number[];
  lightGain: number;
  specGain: number;
  specPower: number;
  rimGain: number;
}

export const RELIGHT_STATIC_UNIFORMS: RelightUniforms = {
  lightDir: [LIGHT_DIR.x, LIGHT_DIR.y, DYNAMIC_RELIGHT.LIGHT_Z],
  specTint: tintUnit(SPECULAR_TINT),
  rimTint: tintUnit(RIM_TINT),
  lightGain: DYNAMIC_RELIGHT.LIGHT_GAIN,
  specGain: DYNAMIC_RELIGHT.SPEC_GAIN,
  specPower: DYNAMIC_RELIGHT.SPEC_POWER,
  rimGain: DYNAMIC_RELIGHT.RIM_GAIN,
};

/**
 * Every relight term off. Two callers: `scripts/verify-aquarium.ts`'s
 * identity assertion, and `render/fish-layer.tsx` when a fish has no normal
 * map — with the gains at zero the second child shader's contents stop
 * mattering at all, which is what lets that fallback reuse the albedo image
 * instead of allocating a dummy texture.
 */
export const RELIGHT_OFF_UNIFORMS: RelightUniforms & RelightPose = {
  ...RELIGHT_STATIC_UNIFORMS,
  yawCos: 1,
  yawSin: 0,
  mirrorX: 1,
  lightGain: 0,
  specGain: 0,
  rimGain: 0,
};

/**
 * Turns a swim heading into the shader's vertical-axis rotation.
 *
 * Two corrections, both easy to get silently wrong. (1) The fish is BROADSIDE
 * at `cos(yaw) = ±1` and edge-on at `sin(yaw) = ±1` — that is the convention
 * `render/screen-transform.ts`'s `matrixW` already encodes — so the rotation
 * the surface actually undergoes has `cos = |cos(yaw)|`, not `cos(yaw)`;
 * without the absolute value a fish swimming left would light as if inside
 * out. (2) This shader runs in PRE-mirror local space while the draw mirrors
 * whenever `cos(yaw) >= 0`, so the rotation has to be negated exactly there to
 * survive the mirror with the light still coming from the same side of the
 * tank.
 *
 * Deliberately NOT floored by `EDGE_ON_MIN_WIDTH`: that floor is a legibility
 * hack on the drawn silhouette, and applying it here would stop the lighting
 * turning through the last part of a turn — the most valuable part.
 */
export function relightYaw(yaw: number): RelightPose {
  "worklet"; // called from the render layers' useDerivedValue (UI thread)
  const c = Math.cos(yaw);
  return {
    // The surface rotation, NOT the heading: the animal is broadside at
    // cos(yaw) = ±1 and edge-on at sin(yaw) = ±1 (the convention
    // render/screen-transform.ts's matrixW already encodes), so the rotation
    // it actually undergoes has cosine |cos yaw|. Without the absolute value
    // an animal swimming left lights as if inside out.
    yawCos: Math.abs(c),
    yawSin: Math.sin(yaw) * (c >= 0 ? 1 : -1),
    // matrixW is negative exactly when cos(yaw) >= 0 — that is where the art
    // (drawn nose-left) is mirrored to face right.
    mirrorX: c >= 0 ? -1 : 1,
  };
}

/**
 * The pose for something whose mirror is INDEPENDENT of any heading — the
 * snail, which never swims and is flipped by its crawl direction alone
 * (`sim/crawl.ts`'s `dir`). Broadside, mirrored or not.
 */
export function relightMirrorOnly(dir: number): RelightPose {
  "worklet";
  return { yawCos: 1, yawSin: 0, mirrorX: dir >= 0 ? 1 : -1 };
}
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
    // The REAL gains, not the off ones: the point of a warmup is to compile
    // the branchless code path the first real frame will run, and a driver
    // is free to specialise a shader around uniforms it can see are zero.
    ...RELIGHT_STATIC_UNIFORMS,
    yawCos: 1,
    yawSin: 0,
    mirrorX: 1,
  };
  const shader = effect.makeShaderWithChildren(
    WARP_UNIFORM_KEYS.flatMap((key) => uniforms[key]),
    // Same 2x2 image for both children — this only has to exercise the
    // compile, and the normal child's contents are irrelevant to that.
    [childShader, childShader],
  );
  const paint = Skia.Paint();
  paint.setShader(shader);
  outSurface.getCanvas().drawPaint(paint);
  childSurface.dispose();
  outSurface.dispose();
}
