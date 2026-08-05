import type { Rarity, RarityTier } from "./types";

export const RARITY_COLORS: Record<RarityTier, string> = {
  common: "#9aa3ad",
  uncommon: "#39d98a",
  rare: "#37b6ff",
  epic: "#a06cf5",
  legendary: "#ffc857",
};

export const RARITY_LABELS: Record<RarityTier, string> = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  epic: "Epic",
  legendary: "Legendary",
};

/** "Epic ★★★", "Rare ★", "Common"… */
export function formatRarity(rarity: Rarity): string {
  const stars = rarity.stars ? ` ${"★".repeat(rarity.stars)}` : "";
  return `${RARITY_LABELS[rarity.tier]}${stars}`;
}
