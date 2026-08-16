// V2's own pattern vocabulary — an override layer on top of
// `@/shared/fish/catalog.ts`'s `COLOR_DEFS`, covering only the 6 color
// varieties (zebra, tiger, sakura, caramelZebra, electricBlue, sanke) that
// shipped as `custom` (1,726 hand-drawn shapes in the OLD renderer's local
// coordinates — see `pigment.ts`'s header). This renderer draws its own
// original patterns for those 6 instead.
//
// Why an override file and not editing `catalog.ts` directly: `catalog.ts`
// also feeds the legacy 2D renderer (`render-spec.ts`) and the 3D renderer's
// skin bake — editing it would change those two renderers' fish too, and
// force new pattern types into the legacy renderer's exhaustive pattern
// switch just to keep it compiling, violating this tree's standing rule of
// never touching the old renderer's files (see `aquarium/README.md`). Once
// the legacy renderer is eventually deleted, fold `OVERRIDES` back into
// `catalog.ts` and delete this file.
//
// `custom` is excluded from `AquariumPattern` by construction, not
// convention — a hand-placed absolute-coordinate shape can never reach this
// renderer again; `pigment.ts`'s `patternPrimitives` has no `case "custom"`.
//
// Dependency-free: no React/RN/Skia. Runs under plain Node.

import { getColorDef } from "@/shared/fish/catalog";
import { isGeneratedColorId, resolveRecipe } from "@/shared/fish/generated-breed";
import type { BuiltinColorId, ColorDef, FishPattern, PatternTuning } from "@/shared/fish/types";

import { aquariumPatternOf } from "./generated-pattern";

type NonCustomPattern = Exclude<FishPattern, { type: "custom" }>;
type SpecklePattern = Extract<NonCustomPattern, { type: "speckle" }>;

/** Soft-edged vertical/diagonal bands that trace the body contour — replaces zebra/caramelZebra/tiger's old hand-placed stripes. See `pigment.ts`'s `bandsPrimitives`. */
export interface BandsPattern extends PatternTuning {
  type: "bands";
  color: string;
  /** Number of bands across the mid-trunk. */
  count: number;
  /** Band half-width, as a fraction of body length. */
  width: number;
  /** Horizontal lean per band, in local units — 0 = vertical bars. */
  lean: number;
  /** How much narrower a band gets toward the tail, 0-1. */
  taper: number;
  /** "fork" splits the lower half of each band for a flame-stripe read (tiger); "none" is a plain bar. */
  breakStyle: "none" | "fork";
  /** Blur multiplier on the soft under-pass — higher reads softer-edged. */
  softness: number;
}

/** Scattered soft-edged 5-petal blossom clusters, plus a few lone drifting petals — sakura only. See `pigment.ts`'s `blossomPrimitives`. */
export interface BlossomPattern extends PatternTuning {
  type: "blossom";
  colors: string[];
  clusters: number;
  singles: number;
  petals?: number;
  /** Petal radius, as a fraction of body half-height. */
  radius: number;
}

export type AquariumPattern =
  | Exclude<NonCustomPattern, { type: "speckle" }>
  | (SpecklePattern & { clustered?: boolean })
  | BandsPattern
  | BlossomPattern;

export interface AquariumColorDef extends Omit<ColorDef, "pattern"> {
  pattern: AquariumPattern;
}

interface Override {
  pattern: AquariumPattern;
  palette?: Partial<ColorDef["palette"]>;
}

// Keyed by `BuiltinColorId`, not `ColorId`: overrides exist to re-draw the six
// hand-authored `custom` varieties, and a generated breed never needs one (it
// emits this renderer's pattern vocabulary directly — see `aquariumColorDef`).
const OVERRIDES: Partial<Record<BuiltinColorId, Override>> = {
  zebra: {
    pattern: {
      type: "stripes",
      color: "#15181d",
      style: "clean",
    },
    // The old all-white placeholder palette was fine only because the
    // 1,726 hand-drawn shapes WERE the fish's entire visual identity — a
    // procedural pattern needs a real body gradient underneath it.
    palette: {
      back: "#dfe4ea",
      mid: "#f4f7fa",
      belly: "#ffffff",
      fin: "#eceff3",
      finRay: "#9aa4ae",
    },
  },
  caramelZebra: {
    pattern: {
      type: "stripes",
      color: "#241b12",
      style: "clean",
    },
  },
  tiger: {
    pattern: {
      type: "stripes",
      color: "#1a1208",
      style: "clean",
    },
  },
  sakura: {
    pattern: {
      type: "blossom",
      colors: ["#f7a8b8", "#ffffff", "#ef6f6c"],
      clusters: 3,
      singles: 5,
      radius: 0.34,
    },
  },
  sanke: {
    pattern: { type: "patches", style: "koi", colors: ["#FF0000", "#1c1e24"] },
  },
  electricBlue: {
    pattern: { type: "speckle", color: "#8fd8ff", spread: "body", metallic: true, clustered: true },
    palette: {
      back: "#0b2d63",
      mid: "#1e5fd0",
      belly: "#7fc4ff",
      fin: "#123a7a",
      finRay: "#061a3c",
    },
  },
};

/** Applies this renderer's pattern/palette overrides, if any, over a `catalog.ts` color def. Every other variety passes through unchanged. */
export function aquariumColorDef(def: ColorDef): AquariumColorDef {
  // A generated breed's rich pattern. Keyed off the ID, never off `def.pattern`
  // — by the time a def reaches here its pattern has already been downgraded,
  // so the id is the only signal left. `def` is spread FIRST and only
  // `pattern` replaced, because `bake-fish.ts` reads palette/rarity/shimmer off
  // the un-upgraded def while reading pattern off this one: the two views have
  // to agree on everything else or a fish is lit for one breed and painted as
  // another.
  if (isGeneratedColorId(def.id)) {
    const recipe = resolveRecipe(def.id);
    if (recipe) return { ...def, pattern: aquariumPatternOf(recipe) };
  }
  const override = OVERRIDES[def.id as BuiltinColorId];
  if (!override) return def as AquariumColorDef;
  return {
    ...def,
    pattern: override.pattern,
    palette: override.palette ? { ...def.palette, ...override.palette } : def.palette,
  };
}

/** Convenience wrapper — `aquariumColorDef(getColorDef(id))`. */
export function getAquariumColorDef(id: BuiltinColorId): AquariumColorDef {
  return aquariumColorDef(getColorDef(id));
}
