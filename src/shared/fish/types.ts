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
  | "sanke";

export type BodyId = "standard" | "balloon";
export type TailId = "round" | "lyretail";
export type DorsalId = "standard" | "sailfin";

/** A concrete fish: user-chosen color + rolled body/tail/dorsal. */
export interface FishTraits {
  color: ColorId;
  body: BodyId;
  tail: TailId;
  dorsal: DorsalId;
}

export type LifeStage = "egg" | "fry" | "juvenile" | "adult";

export type UnlockRule =
  | { type: "default" }
  | { type: "sessionMinutes"; minutes: number }
  | { type: "totalHours"; hours: number }
  | { type: "streakDays"; days: number }
  /** Streak OR a manual grant (dev/event stand-in). */
  | { type: "streakOrGrant"; days: number };

export type FishPattern =
  | { type: "solid" }
  /** Dalmatian: round spots; optionally spilling onto the tail/fins. */
  | { type: "spots"; color: string; onFins?: boolean }
  /**
   * Fine speckles — rear-weighted by default (gold dust), or dusted over the
   * whole flank ("body", black diamond). `frontColor` washes the head and
   * shoulders in a second colour before the speckles land. `metallic` swaps
   * the sparkle pass from small painted dots to a sparser set of tinted
   * diagonal light-glint streaks — reads as reflected light off a glossy
   * surface rather than dusted-on pigment (black diamond).
   */
  | {
      type: "speckle";
      color: string;
      spread?: "rear" | "body";
      frontColor?: string;
      metallic?: boolean;
    }
  /** Zebra/caramel zebra = clean bars, tiger = broken bars. */
  | { type: "stripes"; color: string; style: "clean" | "broken" }
  /**
   * Blotches of other colors over the base:
   * koi = red head patch + bold black patches (sanke),
   * calico = distinct mid-size patches (trio),
   * soft = blurry-edged pastel patches (sakura).
   */
  | { type: "patches"; colors: string[]; style: "koi" | "calico" | "soft" };

export type ShimmerKind = "silver" | "bluePurple" | "iridescent";

export interface ColorDef {
  id: ColorId;
  /** Unlock sequence & Fishdex order (1-based). */
  order: number;
  name: string;
  description: string;
  rarity: Rarity;
  /**
   * UI chips/badges, and — for rare+ tiers — the colour of the rendered
   * eye-ring rarity accent (see `Material.eyeRing` in render-spec.ts).
   */
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
