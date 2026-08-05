export type VariantId =
  "black" | "goldDust" | "dalmatian" | "sailfin" | "balloon" | "lyretail" | "marble";

export type LifeStage = "egg" | "fry" | "juvenile" | "adult";

export type UnlockRule =
  | { type: "default" }
  | { type: "sessionMinutes"; minutes: number }
  | { type: "streakDays"; days: number }
  | { type: "totalHours"; hours: number };

export interface FishVariant {
  id: VariantId;
  name: string;
  description: string;
  /** UI chips / fishdex cards — not fish rendering. */
  accentColor: string;
  /** Drives the built-in vector renderer until real sprite art is dropped in. */
  colors: {
    body: string;
    belly: string;
    fin: string;
    spots?: string;
  };
  bodyShape: "standard" | "balloon";
  finShape: "standard" | "sailfin" | "lyretail";
  unlock: UnlockRule;
}

export interface OwnedFish {
  id: string;
  variantId: VariantId;
  status: "alive" | "dead";
  earnedAt: number;
  sessionMinutes: number;
}
