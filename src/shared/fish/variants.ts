import type { FishVariant, VariantId } from "./types";

export const FISH_VARIANTS: readonly FishVariant[] = [
  {
    id: "black",
    name: "Black Molly",
    description: "The classic. Velvet-black and easygoing.",
    accentColor: "#5b6b8c",
    colors: { body: "#20242e", belly: "#333a4a", fin: "#141821" },
    bodyShape: "standard",
    finShape: "standard",
    unlock: { type: "default" },
  },
  {
    id: "goldDust",
    name: "Gold Dust Molly",
    description: "Shimmers like sunlight through shallow water.",
    accentColor: "#f2b53a",
    colors: { body: "#f2b53a", belly: "#f8d47e", fin: "#e08a1e" },
    bodyShape: "standard",
    finShape: "standard",
    unlock: { type: "sessionMinutes", minutes: 30 },
  },
  {
    id: "dalmatian",
    name: "Dalmatian Molly",
    description: "White with ink-black speckles — no two alike.",
    accentColor: "#cfd6dc",
    colors: {
      body: "#e8ecef",
      belly: "#ffffff",
      fin: "#c3cbd2",
      spots: "#23272e",
    },
    bodyShape: "standard",
    finShape: "standard",
    unlock: { type: "sessionMinutes", minutes: 60 },
  },
  {
    id: "sailfin",
    name: "Sailfin Molly",
    description: "Raises a huge dorsal fin like a ship at full sail.",
    accentColor: "#7fb069",
    colors: { body: "#8aa77b", belly: "#c9d8b6", fin: "#5c7d52" },
    bodyShape: "standard",
    finShape: "sailfin",
    unlock: { type: "sessionMinutes", minutes: 90 },
  },
  {
    id: "balloon",
    name: "Balloon Molly",
    description: "Round, buoyant, and utterly unbothered.",
    accentColor: "#f5c96b",
    colors: { body: "#f5c96b", belly: "#fdf3d7", fin: "#e0973f" },
    bodyShape: "balloon",
    finShape: "standard",
    unlock: { type: "streakDays", days: 3 },
  },
  {
    id: "lyretail",
    name: "Lyretail Molly",
    description: "Trails an elegant twin-pointed tail.",
    accentColor: "#6fa8dc",
    colors: { body: "#384f63", belly: "#7d97ab", fin: "#26394a" },
    bodyShape: "standard",
    finShape: "lyretail",
    unlock: { type: "streakDays", days: 7 },
  },
  {
    id: "marble",
    name: "Marble Molly",
    description: "Swirled black and pearl, like living marble.",
    accentColor: "#b8bec7",
    colors: {
      body: "#d9dde2",
      belly: "#f2f4f6",
      fin: "#9aa3ad",
      spots: "#1e222a",
    },
    bodyShape: "standard",
    finShape: "standard",
    unlock: { type: "totalHours", hours: 10 },
  },
] as const;

export const DEFAULT_VARIANT_ID: VariantId = "black";

export function getVariant(id: VariantId): FishVariant {
  const found = FISH_VARIANTS.find((v) => v.id === id);
  return found ?? FISH_VARIANTS[0];
}
