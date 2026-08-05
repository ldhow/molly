import type { LifeStage, VariantId } from "@/shared/fish/types";

/**
 * Sprite manifest: variant × stage → bundled image asset.
 *
 * Drop AI-generated sprites into assets/fish/<variantId>/<stage>.png
 * (see assets/fish/README.md for the art spec + prompt pack), then register
 * them here, e.g.:
 *
 *   black: { adult: require("@/assets/fish/black/adult.png") },
 *
 * Any variant/stage without an entry falls back to the built-in vector
 * renderer, so the app is fully usable before any art exists.
 */
const FISH_SPRITES: Partial<Record<VariantId, Partial<Record<LifeStage, number>>>> = {};

export function spriteFor(variantId: VariantId, stage: LifeStage): number | null {
  return FISH_SPRITES[variantId]?.[stage] ?? null;
}
