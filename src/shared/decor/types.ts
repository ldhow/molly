import type { SpriteId } from "@/shared/aquarium";
import type { Rarity } from "@/shared/lib/roll";

/**
 * 6 depth tiers, farthest to nearest. "far" is deliberately absent — that
 * band belongs to the backdrop fill (`scene/backdrop-sprites.ts`), never to
 * owned decor. See `scape.ts`. These map 1:1 onto `SceneLayer`'s own tiers
 * (`scene/types.ts`) — `scapeFromItems` passes them straight through.
 */
export type DecorLayer = "back" | "backMid" | "mid" | "frontMid" | "front" | "frontMost";

export interface DecorItemDef {
  /** The catalogue key IS the `SCENE_SPRITES` key it draws. */
  id: SpriteId;
  name: string;
  description: string;
  rarity: Rarity;
  price: number;
  layers: readonly DecorLayer[];
  minScale: number;
  defaultScale: number;
  maxScale: number;
  /** Forwarded to `SpritePlacement.maxHeightFraction` — the landscape-wall
   *  guard some tall/wide sprites need (see `compose-sprites.ts`). */
  maxHeightFraction?: number;
  category: "hardscape" | "plant" | "accent";
}

/**
 * A plain, DB-free description of one owned+placed decor item — deliberately
 * not `DecorItemRow` (the drizzle row shape), so `scape.ts` stays importable
 * from Node tooling without pulling in a DB client. `layer`/`xFraction`/
 * `scale`/`sortOrder` are always present here; an unplaced (inventory-only)
 * item simply isn't included in the list passed to `scapeFromItems`.
 */
export interface PlacedDecor {
  id: string;
  itemId: SpriteId;
  layer: DecorLayer;
  xFraction: number;
  scale: number;
  mirror: boolean;
  sortOrder: number;
}
