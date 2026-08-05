import type { ColorId, LifeStage } from "@/shared/fish/types";

/**
 * Sprite manifest: color × stage → bundled image asset.
 *
 * Drop AI-generated sprites into assets/fish/<colorId>/<stage>.png
 * (see assets/fish/README.md for the art spec + prompt pack), then register
 * them here, e.g.:
 *
 *   black: { adult: require("@/assets/fish/black/adult.png") },
 *
 * Any color/stage without an entry falls back to the built-in render-spec
 * drawing, so the app is fully usable before any art exists.
 */
const FISH_SPRITES: Partial<Record<ColorId, Partial<Record<LifeStage, number>>>> = {};

export function spriteFor(colorId: ColorId, stage: LifeStage): number | null {
  return FISH_SPRITES[colorId]?.[stage] ?? null;
}
