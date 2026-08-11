export type RarityTier = "common" | "uncommon" | "rare" | "epic" | "legendary";

export interface Rarity {
  tier: RarityTier;
  /** Sub-tier within rare/epic, shown as ★s (e.g. Epic ★★★). */
  stars?: 1 | 2 | 3;
}

export type ColorId =
  | "goldDust"
  | "dalmatian"
  | "sunkiss"
  | "black"
  | "gold"
  | "platinum"
  | "chocolate"
  | "zebra"
  | "tiger"
  | "sakura"
  | "trio"
  | "caramelZebra"
  | "electricBlue"
  | "blackDiamond"
  | "sanke"
  | "shadowVeil";

export type BodyId = "standard" | "balloon";
export type TailId = "round" | "lyretail";
export type DorsalId = "standard" | "sailfin";

/** A concrete fish: user-chosen color + rolled body/tail/dorsal. */
export interface FishTraits {
  color: ColorId;
  body: BodyId;
  tail: TailId;
  dorsal: DorsalId;
  /**
   * Which of the color's procedural pattern variants this individual fish
   * rolls (0 when absent) — deterministic per session id via
   * `bucketFromString()`, not persisted. Keeps fish of the same color/body/
   * tail/dorsal from being pixel-identical while still sharing a bake-cache
   * bucket with the others that land on the same variant. See
   * `traitsOfRow()` in catalog.ts and `useSettleSession`.
   */
  patternSeed?: number;
}

export type LifeStage = "egg" | "fry" | "juvenile" | "adult";

export type UnlockRule =
  | { type: "default" }
  | { type: "sessionMinutes"; minutes: number }
  | { type: "totalHours"; hours: number }
  | { type: "streakDays"; days: number }
  /** Streak OR a manual grant (dev/event stand-in). */
  | { type: "streakOrGrant"; days: number };

/**
 * Optional per-variety knobs for the procedural generators in
 * patternPrimitives() — unset means "use the generator's built-in default",
 * so every existing catalog.ts entry renders unchanged until hand-tuned.
 */
export interface PatternTuning {
  /** Multiplier on generated-primitive count (spots/speckles/stripes/patches). Default 1. */
  density?: number;
  /** Multiplier on size — radius/width/patch extent. Default 1. */
  scale?: number;
  /** Multiplier on wobble/jitter/lean/curvature/break-chance. Default 1. */
  randomness?: number;
}

export type FishPattern =
  | { type: "solid" }
  /** Dalmatian: round spots; optionally spilling onto the tail/fins. */
  | ({ type: "spots"; color: string; onFins?: boolean } & PatternTuning)
  /**
   * Fine speckles — rear-weighted by default (gold dust), or dusted over the
   * whole flank ("body", black diamond). `frontColor` washes the head and
   * shoulders in a second colour before the speckles land. `metallic` swaps
   * the sparkle pass from small painted dots to a sparser set of tinted
   * diagonal light-glint streaks — reads as reflected light off a glossy
   * surface rather than dusted-on pigment (black diamond).
   */
  | ({
      type: "speckle";
      color: string;
      spread?: "rear" | "body";
      frontColor?: string;
      metallic?: boolean;
    } & PatternTuning)
  /** Zebra/caramel zebra = clean bars, tiger = broken bars. */
  | ({ type: "stripes"; color: string; style: "clean" | "broken" } & PatternTuning)
  /**
   * Blotches of other colors over the base:
   * koi = red head patch + bold black patches (sanke),
   * calico = distinct mid-size patches (trio),
   * soft = blurry-edged pastel patches (sakura).
   */
  | ({ type: "patches"; colors: string[]; style: "koi" | "calico" | "soft" } & PatternTuning)
  /**
   * Hand-drawn markings, in body-local coordinates (see the header comment
   * on render-spec.ts for the coordinate space) — drawn via `yarn fish:colors`,
   * not procedurally generated. No `PatternTuning`: these are literal shapes,
   * not a generator to dial.
   */
  | { type: "custom"; shapes: CustomShape[] };

export type CustomShape =
  /** A filled organic blob — click-placed spots/patches. */
  | {
      kind: "blob";
      cx: number;
      cy: number;
      rx: number;
      ry: number;
      color: string;
      opacity?: number;
    }
  /** A freehand stroke — drag-drawn stripes/marks. `d` is an SVG path string. */
  | { kind: "stroke"; d: string; color: string; width: number; opacity?: number }
  /**
   * A tapered pen stroke — drag-drawn, full width through the middle and
   * pointed at both ends. `d` is a pre-built CLOSED, FILLED ribbon outline
   * (the drawing tool computes the taper client-side; this is just the
   * result), not a centerline + width like `stroke`.
   */
  | { kind: "ribbon"; d: string; color: string; opacity?: number };

export type ShimmerKind = "silver" | "bluePurple" | "iridescent";

export interface ColorDef {
  id: ColorId;
  /** Unlock sequence & Fishdex order (1-based). */
  order: number;
  name: string;
  description: string;
  rarity: Rarity;
  /** UI chips/badges — not fish rendering. */
  accentColor: string;
  palette: {
    back: string;
    mid: string;
    belly: string;
    fin: string;
    finRay: string;
  };
  pattern: FishPattern;
  shimmer?: ShimmerKind;
  unlock: UnlockRule;
}

export interface RollableDef<Id extends string> {
  id: Id;
  name: string;
  rarity: Rarity;
  /** Relative roll weight within its axis. */
  weight: number;
}
