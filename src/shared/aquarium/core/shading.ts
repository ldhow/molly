// How light and tone work in this renderer — the one place both the molly
// (`fish/`) and the five other species (`creatures/`) read from, so they
// cannot drift into disagreeing about where the light comes from or what a
// shadow does to a colour.
//
// WHY THIS EXISTS. Everything here replaces arithmetic that moved colour
// along the VALUE AXIS ONLY. `shared/lib/color.ts`'s `darken`/`lighten` are
// `mix(hex, black)` / `mix(hex, white)` — achromatic moves that desaturate
// as they go. The fish's body ramp was `back -> mid -> belly` at one hue in
// three lightnesses (gold: #bf7c10 / #eda426 / #f8cd63, hue ~40 throughout),
// and all five creatures built `{top: lighten(base,k), mid: base, bottom:
// darken(base,k')}` the same way. A real surface shifts HUE and SATURATION
// as it turns away from the light; a pure value ramp is what "plastic"
// looks like. Every export below is a hue-aware replacement for one of
// those moves.
//
// Dependency-free: no React/RN/Skia. Runs under plain Node, same contract as
// `pigment-toolkit.ts` next door.

import { clamp01, hexToHsl, hslToHex, rgba, wrapHue } from "@/shared/lib/color";

import type { Node, Stop } from "./ir";

/**
 * One shared key-light direction: mostly overhead with a slight lean toward
 * the nose (x negative, since a fish's nose sits at negative local x).
 * Previously a file-local constant in `fish/bake-fish.ts`; hoisted here so a
 * creature's gloss lobe can be placed from the same vector instead of each
 * species hardcoding its own and the tank reading as five separate lightings.
 */
export const LIGHT_DIR = { x: -0.32, y: -0.95 } as const;

/**
 * Hue every shadow rotates toward. VIOLET, not the blue you might expect from
 * "shadows go cool" — and the difference is not cosmetic. Rotating toward
 * blue-220 takes the shortest arc, which for a warm subject runs through
 * GREEN: gold (hue ~40) shaded toward 220 lands on olive, and every warm
 * variety's dorsal turned muddy. Violet-270 is on the far side, so warm hues
 * rotate DOWN through orange/red/magenta (the classic warm-shadow move) and
 * cool hues still rotate up into blue-violet. One anchor, right for both.
 */
const SHADOW_HUE = 270;
/** Warm hue every lit surface rotates toward — the sun through the surface. */
const LIGHT_HUE = 45;
/** Ceiling on how far either move may rotate a hue, so a red fish never goes blue. */
const MAX_SHADOW_ROT = 26;
const MAX_LIGHT_ROT = 16;

/** Signed shortest arc from `from` to `to`, in (-180, 180]. */
function arcTo(from: number, to: number): number {
  const d = wrapHue(to - from);
  return d > 180 ? d - 360 : d;
}

const clampMag = (v: number, max: number) => Math.max(-max, Math.min(max, v));

/**
 * Hue-aware `darken`. Signature-compatible (`t` 0 = unchanged, 1 = fully
 * shadowed) so every existing `darken(base, k)` call site is a one-word swap.
 *
 * Three things happen that `darken` does not do: the hue rotates toward
 * `SHADOW_HUE`, saturation *rises* slightly (a shadow is where a surface's
 * own colour is least washed out by the light, not most), and only then does
 * lightness fall.
 */
export function coolShadow(hex: string, t: number): string {
  const k = clamp01(t);
  const { h, s, l } = hexToHsl(hex);
  return hslToHex(
    h + clampMag(arcTo(h, SHADOW_HUE), MAX_SHADOW_ROT) * k,
    clamp01(s * (1 + 0.34 * k)),
    clamp01(l * (1 - k)),
  );
}

/**
 * Hue-aware `lighten`, same `t` convention. The counterpart asymmetry: a lit
 * surface rotates toward `LIGHT_HUE` and *loses* saturation, because strong
 * light bleaches toward the light's own colour. `lighten` mixed toward pure
 * white, which is the same desaturation but with no hue information at all.
 */
export function warmLight(hex: string, t: number): string {
  const k = clamp01(t);
  const { h, s, l } = hexToHsl(hex);
  return hslToHex(
    h + clampMag(arcTo(h, LIGHT_HUE), MAX_LIGHT_ROT) * k,
    clamp01(s * (1 - 0.42 * k)),
    clamp01(l + (1 - l) * k),
  );
}

// ---------------------------------------------------------------------------
// Specular / rim tint
// ---------------------------------------------------------------------------

/**
 * Underwater the key light has already been filtered through the water column
 * before it reaches anything, so a highlight on a tank animal is a cool
 * blue-white. A literal `rgba(255,255,255,a)` specular over warm skin is the
 * classic "plastic toy" signature, and every gloss lobe in this tree — the
 * fish's two, and one per creature — used exactly that.
 */
export const SPECULAR_TINT = [221, 241, 255] as const;
/** Cooler still: a rim light has wrapped around the silhouette through MORE water. */
export const RIM_TINT = [178, 226, 246] as const;

export function tinted(tint: readonly [number, number, number], alpha: number): string {
  return `rgba(${tint[0]},${tint[1]},${tint[2]},${clamp01(alpha).toFixed(3)})`;
}

// ---------------------------------------------------------------------------
// Counter-shading
// ---------------------------------------------------------------------------

/**
 * Never let the dorsal stop fall more than this far below the variety's own
 * authored `back` lightness. THE IDENTITY GUARD: an earlier version scaled
 * lightness by a flat 0.62, which is mild on a pale breed and crushing on a
 * mid-dark one — it turned goldDust (a GOLD fish with a dark head) into a
 * uniformly dark fish and destroyed what makes the variety recognisable.
 * The catalogue's `back` is the variety's identity; shading may deepen it,
 * not replace it.
 */
const MAX_DORSAL_DROP = 0.16;

/**
 * The body's albedo ramp, top of the back to bottom of the belly.
 *
 * Replaces a 3-stop `back / mid / belly` at offsets 0 / 0.5 / 1. Two things
 * were wrong with that. (1) The three colours are the same hue at three
 * lightnesses, so it shaded like a plastic tube. (2) A real fish's
 * transitions are not evenly spaced — the dorsal darkening is confined to
 * the top sliver, the ventral whitening to the bottom fifth, and the
 * saturated flank owns everything between. Spreading them linearly averages
 * the whole animal to a mid-tone.
 *
 * So: 6 stops, weighted to those bands, moving saturation and hue as well as
 * value. The ventral end desaturates HARD — a real belly is near-achromatic
 * silver, and that (not lightness alone) is what reads as counter-shading.
 * `verify-aquarium.ts` asserts exactly that property over every breed.
 *
 * The catalogue is not touched: `back`/`mid`/`belly` still own the variety's
 * colour, this only reshapes how they are laid down.
 */
export function countershadeStops(back: string, mid: string, belly: string): Stop[] {
  const backL = hexToHsl(back).l;
  const shadowed = coolShadow(back, 0.24);
  const dorsal =
    hexToHsl(shadowed).l < backL - MAX_DORSAL_DROP
      ? hslToHex(hexToHsl(shadowed).h, hexToHsl(shadowed).s, backL - MAX_DORSAL_DROP)
      : shadowed;
  const bellyHsl = hexToHsl(belly);
  return [
    { offset: 0, color: dorsal },
    // The authored `back` itself owns the upper flank rather than the very
    // top edge — the variety's colour stays the largest thing you see.
    { offset: 0.16, color: back },
    { offset: 0.38, color: mid },
    { offset: 0.6, color: warmLight(mid, 0.08) },
    // The ventral desaturation is deliberately partial. Taking it all the way
    // to achromatic (0.16 of the authored saturation) bleached the bottom
    // third of every warm variety to near-white and put a visible band across
    // the flank — a real belly is pale and desaturated, not painted out.
    { offset: 0.82, color: hslToHex(bellyHsl.h + 8, bellyHsl.s * 0.62, bellyHsl.l) },
    { offset: 1, color: hslToHex(bellyHsl.h + 10, bellyHsl.s * 0.34, clamp01(bellyHsl.l * 1.05)) },
  ];
}

// ---------------------------------------------------------------------------
// Iridescence
// ---------------------------------------------------------------------------

/**
 * Mollies are structurally coloured: the flank shifts blue/green/violet with
 * viewing angle, and on the melanistic varieties that sheen is nearly the
 * only thing that reads at all. Nothing in this renderer varied hue ACROSS
 * the body, so every fish was one hue plus grey.
 *
 * Two low-alpha `plusLighter` bands along the lateral line, hue-rotated far
 * from the base in opposite directions and at different vertical offsets — a
 * cheap stand-in for thin-film interference. The perceptual cue that sells it
 * is simply "the colour changes as the surface turns", not physical accuracy.
 *
 * GAIN IS NOT FLAT. `plusLighter` is additive, so an alpha that whispers on a
 * bright flank becomes an oil slick on a dark one (goldDust and shadowVeil
 * both went full teal-and-violet before this was scaled). Tying gain to the
 * base's own lightness is also the physically sensible reading: structural
 * colour competes with the pigment beneath it, and a melanistic fish has far
 * less light bouncing back to compete with.
 */
export function iridescenceBands(
  outlineD: string,
  base: string,
  top: number,
  bottom: number,
): Node[] {
  const { h, s, l } = hexToHsl(base);
  const cool = hslToHex(h + 150, clamp01(s * 1.15), clamp01(l * 1.25));
  const warm = hslToHex(h - 110, clamp01(s * 1.1), clamp01(l * 1.15));
  const gain = clamp01(0.14 + l * 0.74);
  const height = bottom - top;
  const band = (color: string, fromV: number, toV: number, alpha: number): Node => ({
    kind: "path",
    d: outlineD,
    clip: outlineD,
    blend: "plusLighter",
    blur: 3.5,
    paint: {
      type: "linear",
      from: { x: 0, y: top + height * fromV },
      to: { x: 0, y: top + height * toV },
      stops: [
        { offset: 0, color: rgba(color, 0) },
        { offset: 0.5, color: rgba(color, alpha * gain) },
        { offset: 1, color: rgba(color, 0) },
      ],
    },
  });
  return [band(cool, 0.24, 0.62, 0.15), band(warm, 0.48, 0.9, 0.085)];
}

// ---------------------------------------------------------------------------
// Fin membrane
// ---------------------------------------------------------------------------

/**
 * A fin is skin stretched over rays — you see the tank through it. The old
 * numbers (`0.9 / 0.8 / finTrail*0.75`, plus a `0.62`-alpha 1.5px keyline)
 * made an opaque, body-coloured paddle: sunkiss's caudal was `#f98f33` at 80%
 * against a `#fb9e3d` flank, so the tail read as a slab of body. That was the
 * loudest single "this is not a fish" tell in the art.
 *
 * The root stays nearly opaque on purpose — a real fin base IS thick and
 * fleshy where it sockets into the flank — and the fall-off is what does the
 * work.
 *
 * HUE IS DELIBERATELY UNTOUCHED. An earlier attempt mixed every stop toward a
 * single water tint and turned goldDust's black fins, sanke's pink caudal and
 * electricBlue's blue fins all the same grey. Per the art guide, a variety's
 * palette is its identity and must not be recoloured toward one reference —
 * so alpha is the only lever here, and the water behind does the tinting.
 *
 * `TIP_FLOOR` is a legibility floor, not an aesthetic one: tank mode renders
 * at `AQUARIUM_FISH_SCALE = 0.6` against busy decor, and a fin that fades
 * out entirely stops reading as a fin. `RAY_BOOST` pays for the lost fill —
 * at small size the rays are what make a translucent fin legible at all.
 */
export const FIN_MEMBRANE = {
  ROOT_ALPHA: 0.88,
  MID_ALPHA: 0.5,
  TIP_SCALE: 0.38,
  TIP_FLOOR: 0.26,
  /** Caudal only: the opaque body-coloured hub where the tail continues from the peduncle. */
  CAUDAL_HUB_ALPHA: 1,
  CAUDAL_ROOT_ALPHA: 0.82,
  RAY_BOOST: 1.45,
  KEYLINE_ALPHA: 0.2,
  KEYLINE_WIDTH: 1.2,
  KEYLINE_BLUR: 0.6,
} as const;

/** Tip alpha for a fin, honouring both the tier's `finTrail` and the legibility floor. */
export function finTipAlpha(finTrail: number): number {
  return Math.max(FIN_MEMBRANE.TIP_FLOOR, finTrail * FIN_MEMBRANE.TIP_SCALE);
}

// ---------------------------------------------------------------------------
// Contour
// ---------------------------------------------------------------------------

/**
 * The body keyline. Was `0.88` alpha / `2.1px` / `blur 0.15` in
 * `darken(back, 0.45)` — a near-opaque ink outline, and by far the biggest
 * single thing making the fish read as a sticker rather than an animal.
 *
 * These numbers land the molly in the same weight band the five creatures
 * already use (0.6-1.4px multiply strokes): before this it was the only
 * animal in the tank wearing a 2.1px ink line. The colour is hue-rotated cool
 * rather than mixed toward black, so the contour reads as the body turning
 * away from the light instead of as a drawn border.
 */
export const BODY_KEYLINE = {
  ALPHA: 0.34,
  WIDTH: 1.35,
  BLUR: 0.8,
} as const;

/** The contour colour for a variety, from its own `back`. */
export function keylineColor(back: string): string {
  return coolShadow(back, 0.55);
}

// ---------------------------------------------------------------------------
// Dynamic relighting
// ---------------------------------------------------------------------------

/**
 * The one thing every export above cannot do: RESPOND. Countershading, the
 * gloss lobes and the keyline are all laid down at bake time from `LIGHT_DIR`
 * and then frozen into the texture, so the highlight sits perfectly still
 * while the body undulates through a full tail beat, and it is identical
 * whether the fish is broadside or turning edge-on. `fish/normal-map.ts` bakes
 * the body's surface normal so `core/sksl/warp.ts` can light it per-frame from
 * this same vector; these are the gains for that pass.
 *
 * DELIBERATELY SMALL, and deliberately a MODULATION rather than a
 * replacement. The painted pass is what carries every variety's identity and
 * it has been tuned against the catalogue breed by breed — re-lighting from
 * scratch would relitigate all of that. So the shader multiplies the baked
 * colour by `1 + LIGHT_GAIN * mask * dot(n, L)`, which is exactly 1 (a
 * byte-identical no-op, asserted in `scripts/verify-aquarium.ts`) when the
 * gains are zero. Raising `LIGHT_GAIN` past ~0.5 starts double-shading
 * against the countershading ramp; the way to go further is to flatten the
 * painted pass first, not to turn this up.
 */
export const DYNAMIC_RELIGHT = {
  /**
   * How much of the key light points at the viewer. `LIGHT_DIR` is a 2-D
   * screen-space vector; the third component is what decides whether a
   * broadside flank (normal ~ +z) reads as lit or as neutral. 0.55 keeps the
   * flank clearly lit while leaving enough lateral bias that turning the fish
   * visibly changes it — the entire point of the pass.
   */
  LIGHT_Z: 0.55,
  /** Diffuse modulation depth. See above for why this is not larger. */
  LIGHT_GAIN: 0.34,
  /**
   * Additive specular. Tinted with `SPECULAR_TINT`, not white, for the same
   * reason the baked gloss lobes are — see that constant's doc comment.
   */
  SPEC_GAIN: 0.3,
  /**
   * Blinn-Phong exponent. High enough that the lobe stays a lobe rather than
   * washing the whole flank, low enough to survive the coarse
   * `NORMAL_PX_PER_UNIT` the map is baked at.
   */
  SPEC_POWER: 22,
  /**
   * Fresnel rim, tinted with `RIM_TINT`. This is the term that does the most
   * work at yaw: as the fish turns edge-on the flank normal rotates away from
   * the viewer, `n.z` falls, and the body picks up the wrap-around edge light
   * a real fish shows when it presents its side to the water surface.
   */
  RIM_GAIN: 0.22,
} as const;

/** `tint` as the 0-1 float triple the SkSL uniforms want. */
export function tintUnit(tint: readonly [number, number, number]): [number, number, number] {
  return [tint[0] / 255, tint[1] / 255, tint[2] / 255];
}
