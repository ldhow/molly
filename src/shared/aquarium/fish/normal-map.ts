// The body's SURFACE NORMAL field — the piece of information a flat baked
// texture throws away, and the reason the fish reads as a card rather than
// an animal.
//
// WHY THIS EXISTS. Everything this renderer draws is one baked RGBA texture
// per fish, warped by `core/sksl/warp.ts`. That texture carries pigment plus
// PAINTED light: `core/shading.ts`'s countershading ramp and gloss lobes are
// laid down once, at bake time, from a fixed `LIGHT_DIR`. Painted light
// cannot respond to anything — the body bends through a full undulation and
// the highlight sits still; the fish turns from broadside to edge-on
// (`render/screen-transform.ts` squashes it horizontally through `matrixW`)
// and the shading is identical at every yaw. Those two non-responses are the
// loudest remaining "this is a sprite" tells in the art.
//
// So: bake a second, much smaller texture holding the body's normal at every
// point, and let the shader light it per-frame from the SAME `LIGHT_DIR` the
// painted pass used. The painted pass stays exactly as it is — this is a
// modulation on top of it, not a replacement (see `DYNAMIC_RELIGHT` in
// `core/shading.ts` for the gains, which are deliberately small). Nothing
// about pigment, pattern or the catalogue changes.
//
// WHY IT'S ESSENTIALLY FREE. The normal field depends only on the BODY
// PROFILE — `traits.body` and the life stage's vertical squish. Not colour,
// not pattern, not tail, not dorsal. So the whole app needs at most
// `2 bodies x 4 stages = 8` of these maps, shared across every fish in the
// tank, against one albedo bake per distinct (colour, pattern, shape, stage).
// At `NORMAL_PX_PER_UNIT` a map is ~120KB, so the entire set costs well under
// a megabyte no matter how many fish are swimming.
//
// WHY DIRECT PIXEL WRITES rather than the `core/ir.ts` -> `core/emit.ts`
// path everything else in this tree uses. The IR draws paths and gradients;
// a normal field is a per-pixel function of the anatomy with no shape
// vocabulary at all, and approximating it with gradient stops would be both
// less accurate and harder to reason about. `@/shared/fish/raster.ts` set the
// precedent for "write the bytes yourself when the target is a texture, not a
// picture". Being plain arithmetic over `Curve1D`s, this also runs unmodified
// under Node for `scripts/verify-aquarium.ts`.

import { AlphaType, ColorType } from "@shopify/react-native-skia/src/skia/types";

import type { BakedArt } from "@/shared/aquarium/core/bake";
import type { Box } from "@/shared/aquarium/core/ir";
import type { SkiaApi } from "@/shared/aquarium/core/skia-types";
import type { FishTraits, LifeStage } from "@/shared/fish/types";

import { buildFishAnatomy } from "./anatomy";
import { STAGE_SQUISH } from "./bake-fish";
import type { Curve1D } from "./profile";

/**
 * Output pixels per local art unit.
 *
 * Deliberately far coarser than the albedo bake's density-aware DPR (~2-3).
 * A normal field is smooth by construction — no edges, no pattern detail,
 * nothing above the body's own curvature frequency — so it survives linear
 * magnification without visible stepping, and every pixel here is paid for in
 * a per-frame texture fetch. 2 px/unit puts a standard body at ~250x120.
 */
export const NORMAL_PX_PER_UNIT = 2;

/**
 * Slack around the body bbox. Only has to cover the mask feather below plus
 * the nose cap's forward bulge — NOT `bake-fish.ts`'s `BOUNDS_PAD`, because
 * this map covers the body alone. Fins fall outside it, sample the shader's
 * `decal` tile mode, and come back mask 0 (unlit), which is the physically
 * right answer for a thin translucent membrane anyway.
 */
const BOX_PAD = 6;

/**
 * The two ends taper independently of the half-height curve, because depth and
 * WIDTH do not fall off together on a real fish. The head keeps volume right
 * up to the snout while its depth is already dropping (hence a floor, not a
 * fade to zero), and the peduncle squeezes flat well before its depth bottoms
 * out — a caudal peduncle is a blade. Without the tail term the body stays
 * cylindrical into the tail join and lights as a tube capped by a flat fin.
 */
const NOSE_TAPER_END = 0.2;
const TAIL_TAPER_START = 0.52;

/**
 * Everything the volume model needs that is not the silhouette itself.
 * Parameterised (rather than left as molly constants) because the axolotl
 * runs the SAME spine-warp shader and is authored with the SAME
 * `baseTop`/`baseBottom` pchip profile as the molly — see that species'
 * `anatomy.ts` header, which calls the shared approach out explicitly. It is
 * the only creature either of those is true of, so this is a two-caller
 * abstraction on purpose, not a speculative one.
 */
export interface BodyVolume {
  baseTop: Curve1D;
  baseBottom: Curve1D;
  x0: number;
  length: number;
  /** Body-only bbox in local space, BEFORE any stage squish. */
  bodyBox: Box;
  /** The bake's vertical squish — `core/bake.ts`'s `squishY`. 1 for anything without life stages. */
  squish: number;
  /**
   * Half-thickness as a fraction of the local half-height.
   *
   * THE single number that sets how domed the relighting reads: at 1.0 the
   * body lights like a cylinder (the highlight band collapses to a thin
   * stripe down the lateral line), at 0.3 like a sheet of paper with a slight
   * curl. Well below 1 for a molly, which is laterally compressed — deep and
   * narrow, not round.
   */
  lateralRatio: number;
  /** Thickness floor at the snout, as a fraction of full. */
  noseTaperFloor: number;
  /** How much thickness the tail end loses: 0 none, 1 to nothing. */
  tailTaperDepth: number;
  /**
   * Feather the mask out just before `u = 1`. True where a SEPARATE shape
   * takes over there and an abrupt end would read as a seam (a molly's
   * caudal fin); false where the body genuinely ends in a cap and feathering
   * would unlight it (an axolotl's paddle tail is authored into this very
   * profile, flaring out at u=1 rather than tapering).
   */
  featherTail: boolean;
}

/** Molly: deep and narrow (0.62 keeps the specular lobe reading as a flank), caudal fin takes over at the peduncle. */
const MOLLY_VOLUME = {
  lateralRatio: 0.62,
  noseTaperFloor: 0.58,
  tailTaperDepth: 0.55,
  featherTail: true,
} as const;

/**
 * `t` (normalised height within the cross-section) never reaches exactly ±1.
 * At the silhouette the modelled surface turns exactly perpendicular to the
 * view and `dz/dy` diverges; clamping just short keeps the normal finite and
 * pointing almost-sideways there, which is what produces the rim.
 */
const T_MAX = 0.995;

/** Mask feather, in local units, at the silhouette and at the tail join. */
const EDGE_FEATHER_UNITS = 1.6;
const TAIL_FEATHER_U = 0.06;

/**
 * How far in front of the nose plane the map still evaluates the profile.
 * `profile.ts`'s `pchip` extrapolates linearly along the boundary tangent
 * outside its domain, so this stays smooth — it exists because `anatomy.ts`'s
 * `noseCapPoints` bulges the real silhouette forward of `u = 0` and the head
 * would otherwise lose its mask right at the snout.
 */
const U_MIN = -0.08;

export interface NormalMap {
  width: number;
  height: number;
  /**
   * RGBA8, row-major from the top, ALWAYS opaque.
   * `R`,`G` = the normal's x,y encoded as `n * 0.5 + 0.5`; `B` = the body
   * mask; `A` = 255.
   *
   * `z` is not stored: the vector is unit length and faces the viewer, so the
   * shader recovers `nz = sqrt(1 - nx^2 - ny^2)` exactly (up to the 8-bit
   * quantisation of the other two) and the freed channel carries the mask
   * instead. Keeping alpha at 255 everywhere is what lets the shader read `B`
   * straight out of a premultiplied `eval()` without unpremultiplying.
   */
  data: Uint8Array;
  /** Local-space rect the buffer covers — the same space the albedo bake's `bounds` is in. */
  box: Box;
}

function smoothstep01(t: number): number {
  const x = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

/** Half-thickness of the modelled cross-section at `u`, in local units. */
function halfWidthAt(v: BodyVolume, halfHeight: number, u: number): number {
  const nose = v.noseTaperFloor + (1 - v.noseTaperFloor) * smoothstep01(u / NOSE_TAPER_END);
  const tail = 1 - v.tailTaperDepth * smoothstep01((u - TAIL_TAPER_START) / (1 - TAIL_TAPER_START));
  return v.lateralRatio * halfHeight * nose * tail;
}

interface Section {
  centerY: number;
  halfHeight: number;
  halfWidth: number;
}

/** Cross-section geometry at `u`: vertical centre, half-height, half-thickness. */
function sectionAt(v: BodyVolume, u: number): Section {
  const yTop = -v.baseTop(u);
  const yBottom = v.baseBottom(u);
  const halfHeight = Math.max(1e-3, (yBottom - yTop) / 2);
  return { centerY: (yTop + yBottom) / 2, halfHeight, halfWidth: halfWidthAt(v, halfHeight, u) };
}

/**
 * Builds the body normal + mask buffer for one (body, stage) pair.
 *
 * THE MODEL. The body is treated as a stack of elliptical cross-sections: at
 * each `u` along the spine the silhouette gives the ellipse's half-height
 * (from `baseTop`/`baseBottom`, the same curves `anatomy.ts` draws the outline
 * from — so the volume can never disagree with the drawn shape) and
 * `halfWidthAt` gives its half-thickness. That defines a height field
 * `z = f(x, y)` over the silhouette, whose normal is `(-df/dx, -df/dy, 1)`
 * normalised. The `x` derivative is what makes the head and the peduncle light
 * differently from the flank; without it every cross-section would be lit as
 * an isolated tube.
 *
 * `y` is screen-down throughout, matching `LIGHT_DIR` and the rest of the
 * tree, so `+z` is out of the screen toward the viewer.
 */
export function buildNormalMap(
  volume: BodyVolume,
  pxPerUnit: number = NORMAL_PX_PER_UNIT,
): NormalMap {
  const { x0, length, squish } = volume;

  // The albedo bake squishes its CONTENT vertically about local y = 0 while
  // reporting unsquished bounds (see `core/bake.ts`'s `bakeNodes`), so art
  // authored at anatomy y lands on screen at `y * squish`. Take the box from
  // the unsquished bbox — for `squish <= 1` that is always a superset of where
  // the squished body actually falls — and undo the squish per pixel when
  // sampling the profile, so the two textures stay registered.
  const box: Box = {
    x: volume.bodyBox.x - BOX_PAD,
    y: volume.bodyBox.y - BOX_PAD,
    width: volume.bodyBox.width + BOX_PAD * 2,
    height: volume.bodyBox.height + BOX_PAD * 2,
  };

  const width = Math.max(1, Math.ceil(box.width * pxPerUnit));
  const height = Math.max(1, Math.ceil(box.height * pxPerUnit));
  const data = new Uint8Array(width * height * 4);

  // Central-difference step for d/du. Small enough to track the profile's
  // curvature, large enough that the pchip evaluation's own rounding doesn't
  // dominate the difference.
  const DU = 1e-3;
  const noseFeatherU = 0.5 * -U_MIN + 0.02;

  for (let py = 0; py < height; py++) {
    const localY = box.y + (py + 0.5) / pxPerUnit;
    const anatomyY = localY / squish;
    for (let px = 0; px < width; px++) {
      const localX = box.x + (px + 0.5) / pxPerUnit;
      const i = (py * width + px) * 4;
      const u = (localX - x0) / length;

      let nx = 0;
      let ny = 0;
      let mask = 0;

      if (u >= U_MIN && u <= 1) {
        const s0 = sectionAt(volume, u);
        const t = (anatomyY - s0.centerY) / s0.halfHeight;
        const absT = Math.abs(t);

        if (absT < 1) {
          // Mask: fade out over `EDGE_FEATHER_UNITS` of real distance at the
          // silhouette (converted into `t` units via the local half-height, so
          // a shallow peduncle section doesn't feather away entirely) and over
          // `TAIL_FEATHER_U` at the peduncle, where the caudal fin takes over
          // and an abrupt end would read as a seam.
          const tFeather = Math.min(0.4, EDGE_FEATHER_UNITS / s0.halfHeight);
          const edge = smoothstep01((1 - absT) / tFeather);
          const tail = volume.featherTail ? smoothstep01((1 - u) / TAIL_FEATHER_U) : 1;
          const nose = smoothstep01((u - U_MIN) / noseFeatherU);
          mask = edge * tail * nose;

          const tc = Math.max(-T_MAX, Math.min(T_MAX, t));
          const sq = Math.sqrt(1 - tc * tc);

          // df/dy in ANATOMY space, then converted to screen space: the bake
          // scales y by `squish` without changing the modelled thickness, so a
          // squished stage is genuinely a rounder cross-section per screen
          // pixel and its highlight tightens accordingly.
          const dfdy = (s0.halfWidth * (-tc / sq)) / s0.halfHeight / squish;

          // df/dx through all three of the section's u-dependencies: the
          // thickness itself, the centre drifting, and the height changing
          // (which slides `t` under the point even where `y` is fixed).
          const uPrev = Math.max(U_MIN, u - DU);
          const uNext = Math.min(1, u + DU);
          const dU = uNext - uPrev;
          const sPrev = sectionAt(volume, uPrev);
          const sNext = sectionAt(volume, uNext);
          const dHalfWidth = (sNext.halfWidth - sPrev.halfWidth) / dU / length;
          const dCenter = (sNext.centerY - sPrev.centerY) / dU / length;
          const dHalfHeight = (sNext.halfHeight - sPrev.halfHeight) / dU / length;
          const dtdx = -(dCenter + tc * dHalfHeight) / s0.halfHeight;
          const dfdx = dHalfWidth * sq + s0.halfWidth * (-tc / sq) * dtdx;

          const inv = 1 / Math.hypot(dfdx, dfdy, 1);
          nx = -dfdx * inv;
          ny = -dfdy * inv;
        }
      }

      data[i] = Math.round((nx * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round(mask * 255);
      data[i + 3] = 255;
    }
  }

  return { width, height, data, box };
}

/** The molly volume for one body type and life stage. */
export function mollyVolume(traits: FishTraits, stage: LifeStage): BodyVolume {
  const { baseTop, baseBottom, landmarks } = buildFishAnatomy(traits);
  return {
    ...MOLLY_VOLUME,
    baseTop,
    baseBottom,
    x0: landmarks.x0,
    length: landmarks.length,
    bodyBox: landmarks.bbox,
    squish: STAGE_SQUISH[stage],
  };
}

/** `buildNormalMap` for a molly — the signature every molly call site uses. */
export function buildBodyNormalMap(
  traits: FishTraits,
  stage: LifeStage,
  pxPerUnit: number = NORMAL_PX_PER_UNIT,
): NormalMap {
  return buildNormalMap(mollyVolume(traits, stage), pxPerUnit);
}

/**
 * Colour-, pattern-, tail- and dorsal-blind on purpose — see this file's
 * header. Every fish sharing a body type and life stage shares one map.
 */
export function normalMapKey(traits: FishTraits, stage: LifeStage): string {
  return `${traits.body}|${stage}`;
}

/** Bytes one map's texture costs, for the same LRU accounting `bakeBytes` does. */
export function normalMapBytes(map: NormalMap): number {
  return map.width * map.height * 4;
}

/**
 * Wraps the buffer in an `SkImage` positioned at its local-space box, so it
 * drops straight into the same `BakedArt` shape (and therefore the same
 * `createBakeLru`) the albedo bakes use. Returns null if Skia refuses the
 * allocation, matching `bakeNodes`'s degradation contract — `warp.ts` lights
 * nothing when the map is absent rather than failing to draw the fish.
 */
export function bakeNormalMap(
  Skia: SkiaApi,
  volume: BodyVolume,
  pxPerUnit: number = NORMAL_PX_PER_UNIT,
): BakedArt | null {
  const map = buildNormalMap(volume, pxPerUnit);
  const image = Skia.Image.MakeImage(
    {
      width: map.width,
      height: map.height,
      colorType: ColorType.RGBA_8888,
      // Every pixel is written with alpha 255, so premultiplied and
      // unpremultiplied encodings coincide and `Opaque` costs no conversion on
      // either backend.
      alphaType: AlphaType.Opaque,
    },
    Skia.Data.fromBytes(map.data),
    map.width * 4,
  );
  if (!image) return null;
  return { image, bounds: map.box };
}

/** `bakeNormalMap` for a molly. */
export function bakeBodyNormalMap(
  Skia: SkiaApi,
  traits: FishTraits,
  stage: LifeStage,
  pxPerUnit: number = NORMAL_PX_PER_UNIT,
): BakedArt | null {
  return bakeNormalMap(Skia, mollyVolume(traits, stage), pxPerUnit);
}
