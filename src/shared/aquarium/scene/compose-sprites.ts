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
  /** Fraction of canvas width, [0,1] — same convention as `Placement.xFraction`. */
  xFraction: number;
  scale: number;
  mirror?: boolean;
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
  mid: 7,
  front: 11,
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

    const scale = placement.scale * sizeFactor;
    const width = sprite.width * scale;
    const height = sprite.height * scale;
    const rect = {
      x: -sprite.anchorX * width,
      y: -sprite.anchorY * height,
      width,
      height,
    };

    pieces.push({
      key: `${placement.spriteId}-${index}`,
      spriteId: placement.spriteId,
      layer: placement.layer,
      worldX: placement.xFraction * canvasWidth,
      worldY: substrateY + LAYER_SINK_PX[placement.layer],
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
