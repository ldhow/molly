// Procedurally generated molly breeds — the open-ended counterpart to
// `catalog.ts`'s 16 hand-authored varieties.
//
// A breed is nothing but data: five palette hex strings, a pattern struct, a
// rarity tier and an optional shimmer. `aquarium/fish/pigment.ts` turns that
// data into drawing primitives with no knowledge of where it came from, so a
// generator can mint unlimited real breeds through the exact bake path the
// shipped colours use — no sprite sheets, no AI, no network.
//
// THE ID IS THE RECIPE. A breed id is `gen:<base36 seed>`, and everything
// about the breed is a pure function of that seed. `sessions.color_id` is
// free text, so persisting a breed costs no schema change, and two devices
// resolving the same id land on pixel-identical fish.
//
// TWO PROJECTIONS, ONE RECIPE. `bake-fish.ts` reads `pattern`/`palette` off
// the 2D V2 renderer's upgraded def but `rarity`/`shimmer` off the plain one,
// so both projections MUST agree on everything except `pattern`:
//
//   generateBreedRecipe(seed)  ->  BreedRecipe        (the rich form)
//        |                              |
//        | toColorDef()                 | aquarium/fish/generated-pattern.ts
//        v                              v
//   ColorDef (legal FishPattern)   AquariumPattern (bands/blossom/clustered)
//   -> catalog.ts, legacy renderer, 3D skin bake
//
// Dependency-free: no React/RN/Skia, and deliberately NO import of
// `./catalog` (catalog imports this file — a back-import would be a cycle).
// Runs under plain Node for `scripts/verify-aquarium.ts` and
// `scripts/aquarium-preview.ts`.

import { clamp01, contrastRatio, hexToHsl, hslToHex, wrapHue } from "@/shared/lib/color";
import { makeRng32 } from "@/shared/lib/rng";

import type {
  ColorDef,
  FishPattern,
  PatternTuning,
  Rarity,
  RarityTier,
  ShimmerKind,
} from "./types";

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

export const GEN_ID_PREFIX = "gen:";

/** Max seed, exclusive — the generator's whole space is one uint32. */
const SEED_SPACE = 0x100000000;

export function generatedColorId(seed: number): `gen:${string}` {
  return `${GEN_ID_PREFIX}${(seed >>> 0).toString(36)}`;
}

export function isGeneratedColorId(id: string): boolean {
  return id.startsWith(GEN_ID_PREFIX);
}

/**
 * Parse a generated id back to its seed, or `null` if it isn't one.
 *
 * Deliberately strict — `getColorDef` falls back to Gold Dust on `null`, and a
 * silent wrong-fish fallback is exactly the failure `creature/resolve.ts`'s
 * header warns about. So: lowercase base36 only, no sign, no overflow.
 */
export function seedOfGeneratedId(id: string): number | null {
  if (!id.startsWith(GEN_ID_PREFIX)) return null;
  const body = id.slice(GEN_ID_PREFIX.length);
  if (!/^[0-9a-z]{1,7}$/.test(body)) return null;
  const seed = Number.parseInt(body, 36);
  if (!Number.isInteger(seed) || seed < 0 || seed >= SEED_SPACE) return null;
  // Reject non-canonical spellings ("gen:0a" for 10) so one breed has one id.
  if ((seed >>> 0).toString(36) !== body) return null;
  return seed;
}

/** A fresh random seed. The one impure function here — lab UI / reward rolls. */
export function rollGeneratedSeed(): number {
  return Math.floor(Math.random() * SEED_SPACE) >>> 0;
}

/**
 * Short human-facing disambiguator. Generated names come from finite word
 * banks, so two seeds can legitimately both be "Amber Dust" — the identity is
 * the seed, and this is what lets the UI say so ("Amber Dust · K7Q") without
 * polluting `def.name`, which several screens render bare.
 */
export function strainCode(seed: number): string {
  return (seed >>> 0).toString(36).toUpperCase().padStart(3, "0").slice(-3);
}

// ---------------------------------------------------------------------------
// The rich pattern vocabulary
// ---------------------------------------------------------------------------

/**
 * Every pattern the 2D V2 renderer can draw. Structurally a superset of
 * `FishPattern` (minus `custom`, which is hand-placed absolute-coordinate
 * shapes and can never be generated) plus that renderer's own `bands`,
 * `blossom` and clustered `speckle`.
 *
 * Declared here rather than imported from `aquarium/fish/pattern-defs.ts`
 * because this module sits BELOW the aquarium tree — `catalog.ts` imports it.
 * `aquarium/fish/generated-pattern.ts` holds a compile-time assertion that
 * this union stays assignable to `AquariumPattern`, so the two can't drift
 * silently.
 */
export type GeneratedPattern =
  | { type: "solid" }
  | ({ type: "spots"; color: string; onFins?: boolean } & PatternTuning)
  | ({
      type: "speckle";
      color: string;
      spread?: "rear" | "body";
      frontColor?: string;
      metallic?: boolean;
      clustered?: boolean;
    } & PatternTuning)
  | ({ type: "stripes"; color: string; style: "clean" | "broken" } & PatternTuning)
  | ({ type: "patches"; colors: string[]; style: "koi" | "calico" | "soft" } & PatternTuning)
  | ({
      type: "bands";
      color: string;
      count: number;
      width: number;
      lean: number;
      taper: number;
      breakStyle: "none" | "fork";
      softness: number;
    } & PatternTuning)
  | ({
      type: "blossom";
      colors: string[];
      clusters: number;
      singles: number;
      petals?: number;
      radius: number;
    } & PatternTuning);

export type GeneratedPatternType = GeneratedPattern["type"];

export type HueFamilyId =
  | "red"
  | "coral"
  | "amber"
  | "yellow"
  | "green"
  | "teal"
  | "cyan"
  | "blue"
  | "violet"
  | "magenta"
  | "rose"
  | "ink";

export type HarmonyId = "monochrome" | "analogous" | "complementary" | "splitComplement" | "triad";

/** The full procedural description of one breed. Both projections derive from this. */
export interface BreedRecipe {
  seed: number;
  id: `gen:${string}`;
  name: string;
  description: string;
  accentColor: string;
  palette: ColorDef["palette"];
  rarity: Rarity;
  shimmer?: ShimmerKind;
  pattern: GeneratedPattern;
  /** Kept for naming, the preview gallery and verify assertions. */
  hueFamily: HueFamilyId;
  harmony: HarmonyId;
}

// ---------------------------------------------------------------------------
// Rng helpers — all ranges go through these so the tuning tables read cleanly
// ---------------------------------------------------------------------------

type Rng = () => number;

const range = (rng: Rng, lo: number, hi: number) => lo + rng() * (hi - lo);
const intRange = (rng: Rng, lo: number, hi: number) => Math.floor(range(rng, lo, hi + 1 - 1e-9));
const chance = (rng: Rng, p: number) => rng() < p;
const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length) % xs.length];

function weightedPick<T extends string>(rng: Rng, weights: Record<T, number>): T {
  const keys = Object.keys(weights) as T[];
  let total = 0;
  for (const k of keys) total += Math.max(0, weights[k]);
  let roll = rng() * total;
  for (const k of keys) {
    roll -= Math.max(0, weights[k]);
    if (roll <= 0) return k;
  }
  return keys[keys.length - 1];
}

const clamp = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n);

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

/**
 * `palette.waterMid` from `constants/theme.ts`, inlined rather than imported
 * to keep this module's dependency surface at three pure helpers. It is the
 * background every fish is judged against, so it's the readability target.
 */
const WATER_REF = "#063049";
/** `palette.surface` — what `accentColor` chips sit on. */
const SURFACE_REF = "#0a2438";

interface HueFamily {
  id: HueFamilyId;
  lo: number;
  hi: number;
  weight: number;
  /**
   * Lightness floor for the `back` stop. Yellow has no dark form — drop its
   * lightness and it stops being yellow and becomes olive or mustard, which
   * then drags the whole counter-shade ramp into mud. Real gold and lemon
   * fish are light animals overall, so the warm families start higher.
   */
  minBackL?: number;
}

/**
 * Hue bands 63-79 (bile yellow-green) and 141-159 (harsh spring green) are
 * absent by construction: they go muddy at low lightness and highlighter at
 * high lightness, with no usable window between. Excluding them at the source
 * is far cheaper than trying to repair them downstream.
 */
const HUE_FAMILIES: readonly HueFamily[] = [
  { id: "red", lo: 350, hi: 370, weight: 8 },
  { id: "coral", lo: 12, hi: 38, weight: 12 },
  { id: "amber", lo: 40, hi: 52, weight: 12, minBackL: 0.24 },
  { id: "yellow", lo: 53, hi: 62, weight: 6, minBackL: 0.28 },
  { id: "green", lo: 80, hi: 140, weight: 8 },
  { id: "teal", lo: 160, hi: 190, weight: 10 },
  { id: "cyan", lo: 190, hi: 215, weight: 10 },
  { id: "blue", lo: 216, hi: 248, weight: 12 },
  { id: "violet", lo: 250, hi: 280, weight: 8 },
  { id: "magenta", lo: 285, hi: 320, weight: 8 },
  { id: "rose", lo: 325, hi: 348, weight: 8 },
  { id: "ink", lo: 0, hi: 360, weight: 8 },
];

const MUD_BANDS: readonly (readonly [number, number])[] = [
  [63, 79],
  [141, 159],
];

/** Nudges a hue out of the two unusable bands, always in the same direction. */
function avoidMud(h: number): number {
  let hue = wrapHue(h);
  for (const [lo, hi] of MUD_BANDS) {
    if (hue >= lo && hue <= hi) hue = wrapHue(hi + 20);
  }
  return hue;
}

const HARMONY_WEIGHTS: Record<HarmonyId, number> = {
  monochrome: 26,
  analogous: 30,
  complementary: 14,
  splitComplement: 16,
  triad: 14,
};

function accentHueFor(rng: Rng, harmony: HarmonyId, baseH: number): number {
  const sign = chance(rng, 0.5) ? 1 : -1;
  switch (harmony) {
    case "monochrome":
      return avoidMud(baseH + sign * range(rng, 4, 8));
    case "analogous":
      return avoidMud(baseH + sign * range(rng, 22, 38));
    case "complementary":
      return avoidMud(baseH + 180 + sign * range(rng, 0, 12));
    case "splitComplement":
      return avoidMud(baseH + (chance(rng, 0.5) ? 150 : 210) + sign * range(rng, 0, 10));
    case "triad":
      return avoidMud(baseH + sign * 120 + sign * range(rng, 0, 10));
  }
}

interface PaletteResult {
  palette: ColorDef["palette"];
  accentColor: string;
  hueFamily: HueFamilyId;
  harmony: HarmonyId;
  baseH: number;
  accentH: number;
  /** The `mid` stop in HSL — every pattern-colour decision is made against it. */
  mid: { h: number; s: number; l: number };
}

function generatePalette(rng: Rng): PaletteResult {
  const familyWeights = Object.fromEntries(HUE_FAMILIES.map((f) => [f.id, f.weight])) as Record<
    HueFamilyId,
    number
  >;
  const hueFamily = weightedPick(rng, familyWeights);
  const family = HUE_FAMILIES.find((f) => f.id === hueFamily)!;
  const isInk = hueFamily === "ink";

  let baseH = avoidMud(range(rng, family.lo, family.hi));
  const harmony = weightedPick(rng, HARMONY_WEIGHTS);
  let accentH = accentHueFor(rng, harmony, baseH);

  // One restart is permitted by the camouflage repair below; the flag is what
  // keeps the loop provably terminating.
  let restarted = false;

  const buildRamp = () => {
    if (isInk) {
      // The black / blackDiamond / shadowVeil register: near-achromatic, very
      // dark back, and a belly light enough that the silhouette still reads.
      const s = range(rng, 0.02, 0.1);
      const back = { h: baseH, s, l: range(rng, 0.06, 0.14) };
      const mid = { h: baseH, s: s * 0.9, l: range(rng, 0.16, 0.26) };
      const belly = { h: baseH, s: s * 0.6, l: range(rng, 0.42, 0.66) };
      return { back, mid, belly };
    }
    const backS = range(rng, 0.45, 0.85);
    const backLo = family.minBackL ?? 0.16;
    const back = { h: baseH, s: backS, l: range(rng, backLo, backLo + 0.14) };
    const mid = {
      h: avoidMud(baseH + range(rng, -6, 6)),
      s: backS * range(rng, 0.82, 1),
      l: Math.min(0.62, back.l + range(rng, 0.16, 0.24)),
    };
    const belly = {
      h: avoidMud(baseH + range(rng, -10, 14)),
      s: mid.s * range(rng, 0.3, 0.55),
      l: clamp(mid.l + range(rng, 0.2, 0.3), 0.62, 0.9),
    };
    return { back, mid, belly };
  };

  let { back, mid, belly } = buildRamp();

  // -- Readability repair. Deterministic, no rng, bounded. ------------------
  for (let i = 0; i < 6; i++) {
    let changed = false;

    // 1. The flank has to separate from the water it swims in.
    if (contrastRatio(hslToHex(mid.h, mid.s, mid.l), WATER_REF) < 1.55) {
      mid.l = clamp01(mid.l + 0.06);
      belly.l = clamp01(belly.l + 0.06);
      changed = true;
    }
    // 2. Counter-shading has to read, but not as two unrelated fish halves.
    const span = belly.l - back.l;
    if (span < 0.34) {
      belly.l = clamp01(back.l + 0.34);
      changed = true;
    } else if (span > 0.62) {
      belly.l = clamp01(back.l + 0.62);
      changed = true;
    }
    // 3. Camouflage guard: a deep saturated blue back is very close to
    //    waterTop/waterMid, so the fish dissolves into the background exactly
    //    where the eye looks first. Lift the belly; if that isn't enough,
    //    rotate out of the band once and rebuild.
    if (baseH >= 200 && baseH <= 250 && back.s > 0.5 && back.l < 0.22) {
      if (belly.l < 0.66) {
        belly.l = 0.66;
        changed = true;
      } else if (!restarted && contrastRatio(hslToHex(mid.h, mid.s, mid.l), WATER_REF) < 1.55) {
        restarted = true;
        baseH = avoidMud(baseH + 28);
        accentH = accentHueFor(rng, harmony, baseH);
        ({ back, mid, belly } = buildRamp());
        changed = true;
      }
    }
    // 4. Saturation must fall monotonically toward the belly, or the
    //    counter-shade reads as a colour change rather than light falloff.
    if (mid.s > back.s) {
      mid.s = back.s;
      changed = true;
    }
    if (belly.s > mid.s) {
      belly.s = mid.s;
      changed = true;
    }
    if (!changed) break;
  }

  // -- Fins ----------------------------------------------------------------
  const finStrategy = weightedPick(rng, {
    matched: 62,
    // Pale trailing veils only work over a dark body; over a light one they
    // vanish into the flank.
    veil: back.l <= 0.34 ? 24 : 0,
    accent: 14,
  });
  let fin: { h: number; s: number; l: number };
  switch (finStrategy) {
    case "veil":
      fin = { h: accentH, s: range(rng, 0.06, 0.28), l: range(rng, 0.72, 0.9) };
      break;
    case "accent":
      fin = { h: accentH, s: range(rng, 0.5, 0.8), l: range(rng, 0.3, 0.48) };
      break;
    default:
      fin = { h: baseH, s: back.s * 0.9, l: clamp01(back.l + range(rng, 0.04, 0.12)) };
  }
  // 5. A fin the same tone as the flank reads as a body-shaped smear rather
  //    than a separate membrane.
  const midHex = hslToHex(mid.h, mid.s, mid.l);
  if (contrastRatio(hslToHex(fin.h, fin.s, fin.l), midHex) < 1.25) {
    fin.l = fin.l >= mid.l ? clamp01(fin.l + 0.08) : clamp01(fin.l - 0.08);
  }
  const finRay = { h: fin.h, s: clamp01(fin.s + 0.06), l: clamp(fin.l - 0.2, 0.05, fin.l - 0.14) };

  // -- accentColor (UI chips only, never rendered on a fish) ----------------
  let accentL = clamp(mid.l, 0.42, 0.62);
  const accentS = clamp(mid.s, 0.45, 0.9);
  for (let i = 0; i < 8; i++) {
    if (contrastRatio(hslToHex(baseH, accentS, accentL), SURFACE_REF) >= 3 || accentL >= 0.78)
      break;
    accentL = Math.min(0.78, accentL + 0.06);
  }

  return {
    palette: {
      back: hslToHex(back.h, back.s, back.l),
      mid: midHex,
      belly: hslToHex(belly.h, belly.s, belly.l),
      fin: hslToHex(fin.h, fin.s, fin.l),
      finRay: hslToHex(finRay.h, finRay.s, finRay.l),
    },
    accentColor: hslToHex(baseH, accentS, accentL),
    hueFamily,
    harmony,
    baseH,
    accentH,
    mid,
  };
}

// ---------------------------------------------------------------------------
// Rarity / shimmer
// ---------------------------------------------------------------------------

const RARITY_WEIGHTS: Record<RarityTier, number> = {
  common: 34,
  uncommon: 26,
  rare: 20,
  epic: 13,
  legendary: 7,
};

/**
 * Rarity is not decoration: `materialFor(tier)` drives gloss/bloom/rim on the
 * bake, and `sparklePrimitives` is a no-op below legendary. So the tier a
 * breed rolls literally changes how it's lit.
 */
function generateRarity(rng: Rng): Rarity {
  const tier = weightedPick(rng, RARITY_WEIGHTS);
  if (tier === "rare" || tier === "epic") {
    return { tier, stars: (1 + intRange(rng, 0, 2)) as 1 | 2 | 3 };
  }
  return { tier };
}

const SHIMMER_P: Record<RarityTier, number> = {
  common: 0.06,
  uncommon: 0.15,
  rare: 0.35,
  epic: 0.6,
  legendary: 0.85,
};

function generateShimmer(
  rng: Rng,
  tier: RarityTier,
  baseH: number,
  hueFamily: HueFamilyId,
  forced: boolean,
): ShimmerKind | undefined {
  if (!forced && !chance(rng, SHIMMER_P[tier])) return undefined;
  const weights = { silver: 40, bluePurple: 30, iridescent: 30 };
  if (baseH >= 200 && baseH <= 300) weights.bluePurple = 55;
  if (hueFamily === "ink") weights.silver = 55;
  // Iridescent is the only kind that adds curvature highlight accents, which
  // is the right extra for the tier that already gets sparkles.
  if (tier === "legendary") weights.iridescent = 55;
  return weightedPick(rng, weights) as ShimmerKind;
}

// ---------------------------------------------------------------------------
// Pattern
// ---------------------------------------------------------------------------

const PATTERN_BASE_WEIGHTS: Record<GeneratedPatternType, number> = {
  solid: 14,
  spots: 14,
  speckle: 16,
  stripes: 12,
  bands: 16,
  patches: 14,
  blossom: 8,
};

interface PatternContext {
  hueFamily: HueFamilyId;
  harmony: HarmonyId;
  baseH: number;
  accentH: number;
  /** Every pattern-colour decision is made against the flank, not the back. */
  mid: { h: number; s: number; l: number };
  midHex: string;
  tier: RarityTier;
}

/** Hard-edged shapes need more separation than diffuse ones to not read as grime. */
const CONTRAST_FLOOR: Record<GeneratedPatternType, number> = {
  solid: 0,
  spots: 2.2,
  stripes: 2.2,
  bands: 2.2,
  speckle: 1.9,
  patches: 1.9,
  blossom: 1.9,
};

/**
 * Pattern colour is chosen by contrast, not by dice: build one dark, one
 * light and one saturated candidate, then keep whichever separates best from
 * the flank. Rolling a colour and hoping is what produces the "muddy blob"
 * failure mode.
 */
function patternColor(rng: Rng, ctx: PatternContext, type: GeneratedPatternType): string {
  const candidates = [
    hslToHex(ctx.baseH, range(rng, 0.25, 0.55), range(rng, 0.08, 0.16)), // ink
    hslToHex(ctx.accentH, range(rng, 0.1, 0.35), range(rng, 0.86, 0.96)), // chalk
    hslToHex(ctx.accentH, range(rng, 0.55, 0.85), range(rng, 0.34, 0.52)), // accent
  ];
  const tieBreak = rng();
  let best = candidates[0];
  let bestScore = -1;
  candidates.forEach((c, i) => {
    const score = contrastRatio(c, ctx.midHex) + i * 1e-6 * tieBreak;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  });
  if (bestScore >= CONTRAST_FLOOR[type]) return best;
  // Deterministic escape hatch — push all the way to chalk or ink.
  return ctx.mid.l < 0.5 ? hslToHex(ctx.accentH, 0.15, 0.94) : hslToHex(ctx.baseH, 0.4, 0.08);
}

function tuning(rng: Rng): Required<PatternTuning> {
  return {
    density: range(rng, 0.7, 1.45),
    scale: range(rng, 0.7, 1.4),
    randomness: range(rng, 0.6, 1.45),
  };
}

interface PatternResult {
  pattern: GeneratedPattern;
  /** `solid` at a low tier is indistinguishable from a bare gradient — force shimmer on. */
  forceShimmer: boolean;
}

function generatePattern(rng: Rng, ctx: PatternContext): PatternResult {
  const w = { ...PATTERN_BASE_WEIGHTS };
  if (ctx.hueFamily === "ink") {
    w.speckle += 10;
    w.solid += 6;
    w.blossom -= 6;
  }
  if (ctx.mid.l > 0.72) {
    w.spots += 8;
    w.bands += 8;
    w.solid = 4;
  }
  if (ctx.tier === "epic" || ctx.tier === "legendary") {
    w.solid -= 8;
    w.blossom += 4;
    w.patches += 4;
  }
  if (ctx.harmony === "monochrome") {
    // Multi-colour patterns need a real hue split behind them to read at all.
    w.patches -= 6;
    w.blossom -= 4;
  }

  const type = weightedPick(rng, w);
  const t = tuning(rng);
  const color = patternColor(rng, ctx, type);

  switch (type) {
    case "solid":
      return {
        pattern: { type: "solid" },
        forceShimmer: ctx.tier === "common" || ctx.tier === "uncommon",
      };

    case "spots":
      return {
        pattern: {
          type: "spots",
          color,
          onFins: chance(rng, 0.45),
          density: range(rng, 0.7, 1.5),
          scale: range(rng, 0.75, 1.4),
          randomness: t.randomness,
        },
        forceShimmer: false,
      };

    case "speckle": {
      // The Gold Dust move — a darker wash over head and shoulders before the
      // speckles land. Only when it actually separates from the flank.
      const front = hslToHex(ctx.baseH, ctx.mid.s * 0.9, ctx.mid.l * 0.55);
      const useFront = chance(rng, 0.35) && contrastRatio(front, ctx.midHex) >= 1.6;
      return {
        pattern: {
          type: "speckle",
          color,
          spread: chance(rng, 0.55) ? "body" : "rear",
          ...(useFront ? { frontColor: front } : {}),
          metallic: chance(rng, 0.3),
          clustered: chance(rng, 0.35),
          density: range(rng, 0.7, 1.4),
          scale: range(rng, 0.7, 1.4),
          randomness: range(rng, 0.8, 1.2),
        },
        forceShimmer: false,
      };
    }

    case "stripes":
      return {
        pattern: {
          type: "stripes",
          color,
          style: chance(rng, 0.6) ? "clean" : "broken",
          density: range(rng, 0.75, 1.35),
          scale: range(rng, 0.7, 1.35),
          randomness: range(rng, 0.6, 1.5),
        },
        forceShimmer: false,
      };

    case "bands": {
      const width = range(rng, 0.026, 0.055);
      // Total ink coverage cap: a wide-band, high-count roll otherwise paints
      // the entire trunk one colour and the "band" reads as the body.
      let count = intRange(rng, 4, 9);
      while (count > 4 && count * width * 2 > 0.72) count--;
      return {
        pattern: {
          type: "bands",
          color,
          count,
          width,
          lean: range(rng, -14, 14),
          taper: range(rng, 0, 0.55),
          breakStyle: chance(rng, 0.3) ? "fork" : "none",
          softness: range(rng, 0.6, 1.9),
          density: range(rng, 0.85, 1.2),
          scale: range(rng, 0.85, 1.2),
          randomness: range(rng, 0.7, 1.3),
        },
        forceShimmer: false,
      };
    }

    case "patches": {
      // `koi` draws `colors[0]` as the head patch and bars `colors[1]`, so the
      // more saturated colour has to come first.
      const c1 = color;
      const c1l = hexToHsl(c1).l;
      let c2 = hslToHex(
        ctx.accentH,
        range(rng, 0.45, 0.8),
        c1l < 0.5 ? range(rng, 0.62, 0.82) : range(rng, 0.12, 0.26),
      );
      if (contrastRatio(c2, c1) < 1.7 || contrastRatio(c2, ctx.midHex) < 1.6) {
        c2 = c1l < 0.5 ? hslToHex(ctx.accentH, 0.2, 0.9) : hslToHex(ctx.accentH, 0.5, 0.14);
      }
      return {
        pattern: {
          type: "patches",
          colors: [c1, c2],
          style: weightedPick(rng, { koi: 30, calico: 40, soft: 30 }) as "koi" | "calico" | "soft",
          density: t.density,
          scale: range(rng, 0.8, 1.3),
          randomness: range(rng, 0.7, 1.4),
        },
        forceShimmer: false,
      };
    }

    case "blossom": {
      // Petals stay PALE and low-saturation — a real blossom is nearly white
      // with a tinted heart. Letting them take the accent hue at full strength
      // put turquoise blobs on a coral fish, which reads as damage rather than
      // as petals; the hue split survives, the shouting doesn't. Only the
      // cluster centre keeps real saturation.
      //
      // The generator draws the LAST colour as the cluster core, so `centre`
      // must stay last in this array.
      const petalA = hslToHex(ctx.accentH + 12, range(rng, 0.12, 0.38), range(rng, 0.82, 0.95));
      const petalB = hslToHex(ctx.accentH - 12, range(rng, 0.12, 0.38), range(rng, 0.82, 0.95));
      const centre = hslToHex(ctx.accentH, range(rng, 0.5, 0.8), range(rng, 0.5, 0.66));
      return {
        pattern: {
          type: "blossom",
          colors: [petalA, petalB, centre],
          clusters: intRange(rng, 2, 5),
          singles: intRange(rng, 3, 8),
          petals: chance(rng, 0.15) ? 6 : 5,
          radius: range(rng, 0.22, 0.42),
          density: t.density,
          scale: range(rng, 0.8, 1.25),
          randomness: t.randomness,
        },
        forceShimmer: false,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

const HUE_ADJ: Record<HueFamilyId, readonly string[]> = {
  red: ["Ember", "Crimson", "Ruby", "Vermilion", "Garnet"],
  coral: ["Coral", "Apricot", "Tangerine", "Sunset", "Persimmon"],
  amber: ["Amber", "Honey", "Gilded", "Marigold", "Brass"],
  yellow: ["Citrine", "Lemon", "Saffron", "Sunbeam"],
  green: ["Jade", "Verdant", "Moss", "Olivine", "Fern"],
  teal: ["Teal", "Lagoon", "Seafoam", "Viridian"],
  cyan: ["Azure", "Glacier", "Cerulean", "Aqua"],
  blue: ["Cobalt", "Sapphire", "Indigo", "Midnight", "Abyss"],
  violet: ["Amethyst", "Iris", "Lilac", "Twilight"],
  magenta: ["Orchid", "Fuchsia", "Plum", "Mulberry"],
  rose: ["Rose", "Blush", "Coralline", "Peony"],
  ink: ["Obsidian", "Onyx", "Soot", "Charcoal", "Nightfall"],
};

const PATTERN_NOUN: Record<GeneratedPatternType, readonly string[]> = {
  solid: ["Veil", "Silk", "Glass", "Satin"],
  spots: ["Dalmata", "Freckle", "Pebble", "Domino"],
  speckle: ["Dust", "Frost", "Ash", "Glitter"],
  stripes: ["Zebra", "Tiger", "Ladder", "Comb"],
  bands: ["Banner", "Ripple", "Tide", "Chevron"],
  patches: ["Koi", "Calico", "Harlequin", "Marble"],
  blossom: ["Blossom", "Petal", "Sakura", "Bloom"],
};

const MODIFIERS = ["Royal", "Ghost", "Velvet", "Neon", "Ancient", "Lunar", "Solar", "Wild"];

const MODIFIER_P: Record<RarityTier, number> = {
  common: 0,
  uncommon: 0,
  rare: 0.25,
  epic: 0.45,
  legendary: 0.7,
};

/**
 * The 16 shipped names, as a literal — NOT read from `COLOR_DEFS`, which would
 * make this module import `catalog.ts` and close an import cycle.
 */
const RESERVED_NAMES = new Set(
  [
    "Gold Dust",
    "Dalmatian",
    "Sunkiss",
    "Black",
    "Gold",
    "Platinum",
    "Chocolate",
    "Zebra",
    "Tiger",
    "Sakura",
    "Trio",
    "Caramel Zebra",
    "Electric Blue",
    "Black Diamond",
    "Sanke",
    "Shadow Veil",
  ].map((n) => n.toLowerCase()),
);

const TONE_WORD = (l: number) =>
  l < 0.2 ? "deep" : l < 0.34 ? "dark" : l < 0.5 ? "rich" : l < 0.72 ? "bright" : "pale";
const SAT_WORD = (s: number) =>
  s < 0.15 ? "muted" : s < 0.4 ? "soft" : s < 0.7 ? "vivid" : "electric";

const HARMONY_CLAUSE: Record<HarmonyId, string> = {
  monochrome: "in a single tone from",
  analogous: "shading from",
  complementary: "swinging from",
  splitComplement: "breaking from",
  triad: "turning from",
};

const PATTERN_CLAUSE: Record<GeneratedPatternType, readonly string[]> = {
  solid: ["", "", ""],
  spots: [
    ", scattered with round spots",
    ", flecked with bold spots",
    ", peppered end to end with spots",
  ],
  speckle: [
    ", dusted with fine speckles",
    ", powdered in drifting speckle",
    ", sprinkled with metallic grain",
  ],
  stripes: [", barred head to tail", ", ruled with crisp bars", ", laddered in dark bars"],
  bands: [
    ", wrapped in soft banded ribbons",
    ", rippled with wide contour bands",
    ", banded like a slow tide",
  ],
  patches: [
    ", broken into bold patches",
    ", pieced together in patchwork",
    ", blotched in two tones",
  ],
  blossom: [
    ", scattered with drifting petal clusters",
    ", strewn with soft blossoms",
    ", carrying a fall of petals",
  ],
};

const SHIMMER_CLAUSE: Record<ShimmerKind, readonly string[]> = {
  silver: [", finished with a silver sheen", ", lit by a cool silver gleam"],
  bluePurple: [", washed in a blue-violet shimmer", ", flaring blue to violet in the light"],
  iridescent: [", finished with an iridescent sheen", ", shifting colour as it turns"],
};

interface NameContext {
  hueFamily: HueFamilyId;
  harmony: HarmonyId;
  patternType: GeneratedPatternType;
  tier: RarityTier;
  shimmer?: ShimmerKind;
  palette: ColorDef["palette"];
}

function generateName(rng: Rng, ctx: NameContext): { name: string; description: string } {
  const adjectives = HUE_ADJ[ctx.hueFamily];
  const nouns = PATTERN_NOUN[ctx.patternType];
  const adj = pick(rng, adjectives);
  let nounIndex = Math.floor(rng() * nouns.length) % nouns.length;

  // "Rose Rose", "Coral Coralline" — advance rather than re-roll, so the name
  // stays a pure function of the seed.
  if (adj.slice(0, 4).toLowerCase() === nouns[nounIndex].slice(0, 4).toLowerCase()) {
    nounIndex = (nounIndex + 1) % nouns.length;
  }

  let modIndex = Math.floor(rng() * MODIFIERS.length) % MODIFIERS.length;
  const wantsModifier = chance(rng, MODIFIER_P[ctx.tier]);

  const compose = (withModifier: boolean, ni: number, mi: number) =>
    [withModifier ? MODIFIERS[mi] : null, adj, nouns[ni]].filter(Boolean).join(" ");

  let name = compose(wantsModifier, nounIndex, modIndex);
  // Only a handful of combinations can collide with the shipped 16; bounded
  // walk rather than a loop that could in principle never terminate.
  for (let i = 0; i < 3 && RESERVED_NAMES.has(name.toLowerCase()); i++) {
    modIndex = (modIndex + 1) % MODIFIERS.length;
    nounIndex = (nounIndex + 1) % nouns.length;
    name = compose(true, nounIndex, modIndex);
  }

  const back = hexToHsl(ctx.palette.back);
  const belly = hexToHsl(ctx.palette.belly);
  const paletteClause =
    `${TONE_WORD(back.l)} ${adj.toLowerCase()} back ` +
    `${HARMONY_CLAUSE[ctx.harmony]} ${SAT_WORD(back.s)} flanks ` +
    `into a ${TONE_WORD(belly.l)} belly`;
  const patternClause = pick(rng, PATTERN_CLAUSE[ctx.patternType]);
  const shimmerClause = ctx.shimmer ? pick(rng, SHIMMER_CLAUSE[ctx.shimmer]) : "";
  const sentence = `${paletteClause}${patternClause}${shimmerClause}.`;

  return { name, description: sentence.charAt(0).toUpperCase() + sentence.slice(1) };
}

// ---------------------------------------------------------------------------
// The generator
// ---------------------------------------------------------------------------

/**
 * `bakeFish` resolves a def twice per fish (once via `getColorDef`, once via
 * `aquariumColorDef`), and both go through here — so a bounded memo keeps
 * generation off the per-frame cost. Insertion-ordered eviction; the cap only
 * has to cover the fish visible at once.
 */
const MEMO_CAP = 256;
const memo = new Map<number, BreedRecipe>();

/** Test/verify hook — proves determinism isn't just the memo returning the same object. */
export function clearBreedMemo(): void {
  memo.clear();
}

export function generateBreedRecipe(seed: number): BreedRecipe {
  const key = seed >>> 0;
  const hit = memo.get(key);
  if (hit) return hit;

  const id = generatedColorId(key);
  // Separate streams per concern, so retuning one section doesn't shift every
  // other breed's output — a palette tweak must not reshuffle all the patterns.
  const rngRarity = makeRng32(`breed:${key}:rarity`);
  const rngPalette = makeRng32(`breed:${key}:palette`);
  const rngPattern = makeRng32(`breed:${key}:pattern`);
  const rngName = makeRng32(`breed:${key}:name`);

  // Rarity is rolled first because the pattern weights condition on it.
  const rarity = generateRarity(rngRarity);
  const pal = generatePalette(rngPalette);
  const { pattern, forceShimmer } = generatePattern(rngPattern, {
    hueFamily: pal.hueFamily,
    harmony: pal.harmony,
    baseH: pal.baseH,
    accentH: pal.accentH,
    mid: pal.mid,
    midHex: pal.palette.mid,
    tier: rarity.tier,
  });
  const shimmer = generateShimmer(
    rngRarity,
    rarity.tier,
    pal.baseH,
    pal.hueFamily,
    forceShimmer || pal.hueFamily === "ink",
  );
  const { name, description } = generateName(rngName, {
    hueFamily: pal.hueFamily,
    harmony: pal.harmony,
    patternType: pattern.type,
    tier: rarity.tier,
    shimmer,
    palette: pal.palette,
  });

  const recipe: BreedRecipe = {
    seed: key,
    id,
    name,
    description,
    accentColor: pal.accentColor,
    palette: pal.palette,
    rarity,
    ...(shimmer ? { shimmer } : {}),
    pattern,
    hueFamily: pal.hueFamily,
    harmony: pal.harmony,
  };

  if (memo.size >= MEMO_CAP) memo.delete(memo.keys().next().value as number);
  memo.set(key, recipe);
  return recipe;
}

// ---------------------------------------------------------------------------
// The downgraded projection
// ---------------------------------------------------------------------------

/**
 * Rewrite the rich pattern as a legal `FishPattern`.
 *
 * `bands` and `blossom` and clustered `speckle` exist only in the 2D V2
 * vocabulary; `render-spec.ts`'s pattern switch (which the 3D skin bake runs
 * through) has no case for them. The mappings below preserve the *read* of
 * each pattern rather than its exact geometry: a banded fish still looks
 * barred in 3D, a blossomed one still looks spotted.
 *
 * The divisors are the target generators' own base counts — `stripes` derives
 * its bar count as `round(7 * density)` and `spots` as `round(13 * density)`,
 * so passing `count / 7` and `(petals + singles) / 13` reproduces roughly the
 * same number of marks rather than a default sprinkle.
 */
function downgradePattern(p: GeneratedPattern): FishPattern {
  switch (p.type) {
    case "bands":
      return {
        type: "stripes",
        color: p.color,
        style: p.breakStyle === "fork" ? "broken" : "clean",
        density: p.count / 7,
        scale: p.width / 0.038,
        randomness: p.randomness,
      };
    case "blossom":
      return {
        type: "spots",
        color: p.colors[0],
        onFins: false,
        density: (p.clusters * (p.petals ?? 5) + p.singles) / 13,
        scale: p.radius * 2.2,
        randomness: 1.1,
      };
    case "speckle": {
      // `clustered` is absent from `FishPattern` — drop the key entirely
      // rather than passing `undefined`, so `"clustered" in pattern` is false.
      const { clustered: _clustered, ...rest } = p;
      return rest;
    }
    default:
      return p;
  }
}

/** The `catalog.ts` / legacy-renderer / 3D-safe view of a generated breed. */
export function toColorDef(recipe: BreedRecipe): ColorDef {
  return {
    id: recipe.id,
    // Generated breeds sit outside the unlock ladder that `order` sequences.
    order: 0,
    name: recipe.name,
    description: recipe.description,
    rarity: recipe.rarity,
    accentColor: recipe.accentColor,
    palette: recipe.palette,
    pattern: downgradePattern(recipe.pattern),
    ...(recipe.shimmer ? { shimmer: recipe.shimmer } : {}),
    // Never gated: a generated breed is discovered, not unlocked.
    unlock: { type: "default" },
  };
}

// ---------------------------------------------------------------------------
// Registry — saved breeds override generation
// ---------------------------------------------------------------------------

/**
 * Breeds the user has explicitly saved, whose recipe is persisted verbatim.
 *
 * Regeneration alone would be enough to render any `gen:` id, but a saved
 * breed must survive a future retune of the tables above — otherwise a fish
 * the user kept would silently change colour when the generator improves. So
 * the stored recipe wins, and generation is the fallback for ids that were
 * never saved (or whose store was cleared).
 *
 * A plain Map, not a store: `catalog.ts` and the aquarium tree read through
 * here and must stay runnable under plain Node for the preview/verify
 * scripts, which rules out importing zustand or `expo-sqlite`. The persisted
 * store (`shared/store/generated-breeds-store.ts`) pushes into this; Node
 * scripts push directly.
 */
const registry = new Map<string, BreedRecipe>();

export function registerRecipes(recipes: readonly BreedRecipe[]): void {
  for (const recipe of recipes) registry.set(recipe.id, recipe);
}

/** Replaces the whole registry — what the store's subscription calls. */
export function replaceRecipes(recipes: readonly BreedRecipe[]): void {
  registry.clear();
  registerRecipes(recipes);
}

export function lookupRecipe(id: string): BreedRecipe | undefined {
  return registry.get(id);
}

/** Saved recipe if there is one, else regenerated from the id's own seed. */
export function resolveRecipe(id: string): BreedRecipe | null {
  const saved = registry.get(id);
  if (saved) return saved;
  const seed = seedOfGeneratedId(id);
  if (seed === null) return null;
  return generateBreedRecipe(seed);
}

/** `null` for anything that isn't a well-formed generated id. */
export function generatedColorDefFor(id: string): ColorDef | null {
  const recipe = resolveRecipe(id);
  return recipe ? toColorDef(recipe) : null;
}
