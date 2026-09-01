// The sprite-mode counterpart to `compose.ts`: turns an authored
// `SpriteSceneTheme` into placed, pixel-positioned sprite pieces. Kept
// separate from `compose.ts` rather than folding into `Placement` because
// sprite pieces don't run a generator and don't expose/consume anchors —
// sharing one type would force both paths to carry the other's irrelevant
// fields.
//
// Dependency-free: no React/RN/Skia. `render/sprite-layers.tsx` draws what
// this produces.

import { sizeFactorFor } from "./compose";
import { SCENE_SPRITES, type SpriteId } from "./sprites/sprite-manifest";
import type { SceneLayer, SwimLane } from "./types";

export interface SpritePlacement {
  spriteId: SpriteId;
  layer: SceneLayer;
  /** Fraction of canvas width — same convention as `Placement.xFraction`. Normally [0,1]; `scene/backdrop-sprites.ts` bleeds slightly past both edges so the parallax drift never exposes a seam. */
  xFraction: number;
  scale: number;
  mirror?: boolean;
  /** Px above the substrate line (pre-`sizeFactor`) — the far band's receding bank in `scene/backdrop-sprites.ts`. Same `far`-only restriction as `Placement.yLift`; see its doc for why a lifted back/mid/front piece breaks snail climbing. */
  yLift?: number;
  /**
   * Hard ceiling on drawn height, as a fraction of the WATER COLUMN — the
   * piece is scaled down uniformly if `scale` would exceed it.
   *
   * This exists because `sizeFactorFor` cannot distinguish the two
   * orientations that matter: it clamps to its 0.6 floor at 390x844 AND at
   * 844x390, so a piece sized to be a centrepiece in a 784px portrait column
   * is drawn at exactly the same pixel height in a 330px landscape one,
   * where it becomes a wall. Raising the global floor would rescale every
   * theme; capping the few pieces that are deliberately large is the
   * targeted fix. `verify-aquarium.ts`'s corridor check at 844x390 is what
   * catches a missing cap.
   */
  maxHeightFraction?: number;
  /**
   * Stable identity across recompositions. Authored theme placements leave
   * this unset — the array is a module constant, so the `${spriteId}-${index}`
   * fallback below is already stable for them, and `scripts/lib/sprite-placement-patch.ts`
   * relies on that index-keying to patch entries in place. User-placed decor
   * (the Decor Store) MUST set this to its own row id, or inserting/removing/
   * reordering a piece shifts every later index and remounts unrelated
   * `SpritePiece`s — resetting their sway phase on every purchase.
   */
  id?: string;
}

export interface SpriteSceneTheme {
  name: string;
  placements: SpritePlacement[];
  swimLanes: SwimLane[];
}

export interface PlacedSprite {
  key: string;
  spriteId: SpriteId;
  layer: SceneLayer;
  /** World pixel position of the sprite's anchor point (its "ground" point — see `SceneSprite.anchorX/anchorY`). */
  worldX: number;
  worldY: number;
  scale: number;
  mirror?: boolean;
  swayHeight: number;
  /** Destination rect in LOCAL space (origin at the anchor point) — `render/sprite-layers.tsx` translates this to `worldX/worldY` and draws the sprite image into it, `fit="fill"`. */
  rect: { x: number; y: number; width: number; height: number };
}

export interface ComposedSpriteScene {
  pieces: PlacedSprite[];
  swimLaneRects: { x: number; width: number }[];
}

/**
 * A piece anchored EXACTLY at the sand line reads as cut-out-and-pasted —
 * real rocks/roots/stems sit slightly embedded in the substrate, not
 * balanced on top of it. Sinking each layer's ground point a few px into
 * the sand (more for nearer layers, which is also what makes `front` read
 * as closer) sells "grounded" far better than an exact tangent line.
 */
const LAYER_SINK_PX: Record<SceneLayer, number> = {
  far: 2,
  back: 4,
  backMid: 5,
  mid: 7,
  frontMid: 9,
  front: 11,
  frontMost: 13,
};

export function composeSpriteScene(
  theme: SpriteSceneTheme,
  canvasWidth: number,
  canvasHeight: number,
  substrateY: number,
): ComposedSpriteScene {
  const sizeFactor = sizeFactorFor(canvasWidth, canvasHeight);
  const pieces: PlacedSprite[] = [];

  theme.placements.forEach((placement, index) => {
    const sprite = SCENE_SPRITES[placement.spriteId];
    if (!sprite) return; // manifest entry missing — skip rather than throw, same "degrade gracefully" contract as the rest of sprite mode.

    let scale = placement.scale * sizeFactor;
    // Uniform, so the cap shrinks a piece rather than squashing it.
    if (placement.maxHeightFraction !== undefined) {
      const ceiling = substrateY * placement.maxHeightFraction;
      const drawn = sprite.height * scale;
      if (drawn > ceiling) scale *= ceiling / drawn;
    }
    const width = sprite.width * scale;
    const height = sprite.height * scale;
    const rect = {
      x: -sprite.anchorX * width,
      y: -sprite.anchorY * height,
      width,
      height,
    };

    pieces.push({
      key: placement.id ?? `${placement.spriteId}-${index}`,
      spriteId: placement.spriteId,
      layer: placement.layer,
      worldX: placement.xFraction * canvasWidth,
      // `yLift` scales with the decor, not the canvas — a lifted far-layer
      // piece has to keep its offset proportional to its own size or the
      // bank it forms detaches from the sand line on a short canvas.
      worldY: substrateY + LAYER_SINK_PX[placement.layer] - (placement.yLift ?? 0) * sizeFactor,
      scale,
      mirror: placement.mirror,
      swayHeight: sprite.swayHeight,
      rect,
    });
  });

  const swimLaneRects = theme.swimLanes.map((lane) => ({
    x: lane.xFraction[0] * canvasWidth,
    width: (lane.xFraction[1] - lane.xFraction[0]) * canvasWidth,
  }));

  return { pieces, swimLaneRects };
}
