import type { SessionRow } from "@/db/schema";

import type { BodyId, ColorDef, ColorId, DorsalId, FishTraits, RollableDef, TailId } from "./types";

/**
 * The 15 color/pattern varieties, in unlock order (user-specified table).
 * Palettes are back→mid→belly gradient stops; patterns layer on top.
 */
export const COLOR_DEFS: readonly ColorDef[] = [
  {
    id: "goldDust",
    order: 1,
    name: "Gold Dust",
    description: "Metallic gold up front, fading into black speckles on the rear.",
    rarity: { tier: "common" },
    accentColor: "#f2b53a",
    palette: {
      back: "#d3921f",
      mid: "#f2b53a",
      belly: "#fbd97e",
      fin: "#e8a428",
      finRay: "#8f5c12",
    },
    pattern: { type: "speckle", color: "#23262e" },
    unlock: { type: "default" },
  },
  {
    id: "dalmatian",
    order: 2,
    name: "Dalmatian",
    description: "White body covered with black spots across the body and fins.",
    rarity: { tier: "common" },
    accentColor: "#e8ecef",
    palette: {
      back: "#ccd4da",
      mid: "#eef1f4",
      belly: "#ffffff",
      fin: "#dde3e8",
      finRay: "#8d97a1",
    },
    pattern: { type: "spots", color: "#1e222a", onFins: true },
    unlock: { type: "sessionMinutes", minutes: 25 },
  },
  {
    id: "sunkiss",
    order: 3,
    name: "Sunkiss",
    description: "Warm orange-yellow body with a soft golden gradient.",
    rarity: { tier: "common" },
    accentColor: "#fb8b3c",
    palette: {
      back: "#f5761f",
      mid: "#fb9e3d",
      belly: "#ffe694",
      fin: "#f98f33",
      finRay: "#bd5e10",
    },
    pattern: { type: "solid" },
    unlock: { type: "sessionMinutes", minutes: 45 },
  },
  {
    id: "black",
    order: 4,
    name: "Black",
    description: "Solid jet black from head to tail.",
    rarity: { tier: "common" },
    accentColor: "#5b6b8c",
    palette: {
      back: "#0d0f14",
      mid: "#20242f",
      belly: "#485064",
      fin: "#14171e",
      finRay: "#000000",
    },
    pattern: { type: "solid" },
    unlock: { type: "sessionMinutes", minutes: 90 },
  },
  {
    id: "gold",
    order: 5,
    name: "Gold",
    description: "Rich metallic gold across the entire body.",
    rarity: { tier: "uncommon" },
    accentColor: "#f0a92e",
    palette: {
      back: "#bf7c10",
      mid: "#eda426",
      belly: "#f8cd63",
      fin: "#dd9a1e",
      finRay: "#8a5a0c",
    },
    pattern: { type: "solid" },
    shimmer: "silver",
    unlock: { type: "sessionMinutes", minutes: 120 },
  },
  {
    id: "platinum",
    order: 6,
    name: "Platinum",
    description: "Silver-white body with a subtle metallic shimmer.",
    rarity: { tier: "uncommon" },
    accentColor: "#dbe3e9",
    palette: {
      back: "#a7b4be",
      mid: "#d5dde4",
      belly: "#f6f9fb",
      fin: "#c4cfd7",
      finRay: "#7f909c",
    },
    pattern: { type: "solid" },
    shimmer: "silver",
    unlock: { type: "totalHours", hours: 5 },
  },
  {
    id: "chocolate",
    order: 7,
    name: "Chocolate",
    description: "Deep chocolate brown with warm bronze undertones.",
    rarity: { tier: "rare", stars: 1 },
    accentColor: "#8a5c3a",
    palette: {
      back: "#3a2114",
      mid: "#5d3a22",
      belly: "#96683f",
      fin: "#4c2d19",
      finRay: "#241207",
    },
    pattern: { type: "solid" },
    unlock: { type: "totalHours", hours: 10 },
  },
  {
    id: "zebra",
    order: 8,
    name: "Zebra",
    description: "Light gold-silver base with clean black zebra stripes.",
    rarity: { tier: "rare", stars: 2 },
    accentColor: "#e8e0c0",
    palette: {
      back: "#c9bf98",
      mid: "#e6ddba",
      belly: "#f7f2df",
      fin: "#d6cca6",
      finRay: "#8d8360",
    },
    pattern: { type: "stripes", color: "#22252c", style: "clean" },
    unlock: { type: "totalHours", hours: 20 },
  },
  {
    id: "tiger",
    order: 9,
    name: "Tiger",
    description: "Orange-gold body with broken black tiger stripes.",
    rarity: { tier: "rare", stars: 3 },
    accentColor: "#ef9c33",
    palette: {
      back: "#cf7414",
      mid: "#ef9c33",
      belly: "#f8c56b",
      fin: "#e08d24",
      finRay: "#94520c",
    },
    pattern: { type: "stripes", color: "#1c1e25", style: "broken" },
    unlock: { type: "totalHours", hours: 35 },
  },
  {
    id: "sakura",
    order: 10,
    name: "Sakura",
    description: "Pearl white body accented with soft red and orange patches.",
    rarity: { tier: "epic", stars: 1 },
    accentColor: "#e88a7a",
    palette: {
      back: "#e3d9d6",
      mid: "#f6efed",
      belly: "#ffffff",
      fin: "#efe4e1",
      finRay: "#b39d97",
    },
    pattern: { type: "patches", colors: ["#e26d5a", "#f2a05d"], style: "soft" },
    unlock: { type: "streakDays", days: 7 },
  },
  {
    id: "trio",
    order: 11,
    name: "Trio",
    description: "A balanced mix of white, orange, and black in distinct patches.",
    rarity: { tier: "epic", stars: 2 },
    accentColor: "#f2a03d",
    palette: {
      back: "#dcd8d2",
      mid: "#f2efe9",
      belly: "#ffffff",
      fin: "#e7e2da",
      finRay: "#a3988a",
    },
    pattern: { type: "patches", colors: ["#f2a03d", "#23262e"], style: "calico" },
    unlock: { type: "streakDays", days: 14 },
  },
  {
    id: "caramelZebra",
    order: 12,
    name: "Caramel Zebra",
    description: "Caramel brown body with bold black zebra stripes.",
    rarity: { tier: "epic", stars: 2 },
    accentColor: "#c08a4c",
    palette: {
      back: "#96662f",
      mid: "#c08a4c",
      belly: "#e5bc85",
      fin: "#ad7a3e",
      finRay: "#6b4620",
    },
    pattern: { type: "stripes", color: "#211a12", style: "clean" },
    unlock: { type: "totalHours", hours: 60 },
  },
  {
    id: "electricBlue",
    order: 13,
    name: "Electric Blue",
    description: "Vibrant metallic electric blue with an iridescent shine.",
    rarity: { tier: "epic", stars: 3 },
    accentColor: "#2f6fe4",
    palette: {
      back: "#123b9e",
      mid: "#2f6fe4",
      belly: "#8ec0f6",
      fin: "#2757c4",
      finRay: "#0c2564",
    },
    pattern: { type: "solid" },
    shimmer: "iridescent",
    unlock: { type: "totalHours", hours: 100 },
  },
  {
    id: "blackDiamond",
    order: 14,
    name: "Black Diamond",
    description: "Glossy black with a blue-purple metallic shimmer under light.",
    rarity: { tier: "epic", stars: 3 },
    accentColor: "#8a6cf0",
    palette: {
      back: "#0b0c14",
      mid: "#1d2030",
      belly: "#454c6e",
      fin: "#161927",
      finRay: "#000000",
    },
    pattern: { type: "solid" },
    shimmer: "bluePurple",
    unlock: { type: "streakDays", days: 21 },
  },
  {
    id: "sanke",
    order: 15,
    name: "Sanke",
    description:
      "Bright red head, pearl white body, and bold black patches — the classic Koi Sanke pattern.",
    rarity: { tier: "legendary" },
    accentColor: "#d4402a",
    palette: {
      back: "#ded9d0",
      mid: "#f4f1ea",
      belly: "#ffffff",
      fin: "#eae6dd",
      finRay: "#a89f8f",
    },
    pattern: { type: "patches", colors: ["#d4402a", "#1c1e24"], style: "koi" },
    unlock: { type: "streakOrGrant", days: 30 },
  },
] as const;

export const DEFAULT_COLOR_ID: ColorId = "goldDust";

const colorById = new Map(COLOR_DEFS.map((def) => [def.id, def]));

export function getColorDef(id: string): ColorDef {
  return colorById.get(id as ColorId) ?? COLOR_DEFS[0];
}

// ---------------------------------------------------------------------------
// Rollable traits — rolled at session completion, weighted by rarity.
// ---------------------------------------------------------------------------

export const BODY_DEFS: readonly RollableDef<BodyId>[] = [
  { id: "standard", name: "Standard", rarity: { tier: "common" }, weight: 85 },
  { id: "balloon", name: "Balloon", rarity: { tier: "rare" }, weight: 15 },
];

export const TAIL_DEFS: readonly RollableDef<TailId>[] = [
  { id: "round", name: "Round Tail", rarity: { tier: "common" }, weight: 92 },
  { id: "lyretail", name: "Lyretail", rarity: { tier: "epic" }, weight: 8 },
];

export const DORSAL_DEFS: readonly RollableDef<DorsalId>[] = [
  { id: "standard", name: "Standard Fin", rarity: { tier: "common" }, weight: 85 },
  { id: "sailfin", name: "Sailfin", rarity: { tier: "rare" }, weight: 15 },
];

function rollFrom<Id extends string>(defs: readonly RollableDef<Id>[]): Id {
  const total = defs.reduce((sum, d) => sum + d.weight, 0);
  let ticket = Math.random() * total;
  for (const def of defs) {
    ticket -= def.weight;
    if (ticket < 0) return def.id;
  }
  return defs[0].id;
}

/** The all-common combination (growing fish, failed sessions, previews). */
export function standardTraits(color: ColorId): FishTraits {
  return { color, body: "standard", tail: "round", dorsal: "standard" };
}

/** Rolled at session completion — the reveal moment. */
export function rollTraits(color: ColorId): FishTraits {
  return {
    color,
    body: rollFrom(BODY_DEFS),
    tail: rollFrom(TAIL_DEFS),
    dorsal: rollFrom(DORSAL_DEFS),
  };
}

// ---------------------------------------------------------------------------
// Legacy rows — sessions recorded before the trait system stored only a
// variantId. Map them to sensible trait combinations so old fish keep swimming.
// ---------------------------------------------------------------------------

const LEGACY_VARIANT_TRAITS: Record<string, FishTraits> = {
  black: standardTraits("black"),
  goldDust: standardTraits("goldDust"),
  dalmatian: standardTraits("dalmatian"),
  marble: standardTraits("dalmatian"),
  sailfin: { ...standardTraits("black"), dorsal: "sailfin" },
  balloon: { ...standardTraits("gold"), body: "balloon" },
  lyretail: { ...standardTraits("platinum"), tail: "lyretail" },
};

/** Resolve a session row to traits, falling back to the legacy mapping. */
export function traitsOfRow(row: SessionRow): FishTraits {
  if (row.colorId && row.bodyId && row.tailId && row.dorsalId) {
    return {
      color: getColorDef(row.colorId).id,
      body: row.bodyId as FishTraits["body"],
      tail: row.tailId as FishTraits["tail"],
      dorsal: row.dorsalId as FishTraits["dorsal"],
    };
  }
  return LEGACY_VARIANT_TRAITS[row.variantId] ?? standardTraits(DEFAULT_COLOR_ID);
}
