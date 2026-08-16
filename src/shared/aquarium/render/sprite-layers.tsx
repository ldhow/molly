"use no memo"; // Reads a clock SharedValue inside useDerivedValue per piece —
// same "use no memo" reasoning as scene-layers.tsx.

import {
  Group,
  LinearGradient,
  Rect,
  Skia,
  Image as SkiaImage,
  useClock,
  useImage,
  vec,
} from "@shopify/react-native-skia";
import { useDerivedValue, type SharedValue } from "react-native-reanimated";

import { sandHeightFor } from "@/shared/constants/tank";

import type { PlacedSprite } from "../scene/compose-sprites";
import { DEFAULT_SCENE_DESIGN } from "../scene/scene-design";
import { SPRITE_SOURCES } from "../scene/sprites/sprite-sources";
import { currentAt } from "../sim/swim";

// Same atmospheric-perspective table as scene-layers.tsx's LAYER_OPACITY —
// duplicated rather than imported so sprite mode has no dependency on the
// procedural render module (the two art modes stay independent seams).
const LAYER_OPACITY: Record<PlacedSprite["layer"], number> = {
  far: DEFAULT_SCENE_DESIGN.layers.opacityFar,
  back: DEFAULT_SCENE_DESIGN.layers.opacityBack,
  mid: DEFAULT_SCENE_DESIGN.layers.opacityMid,
  front: DEFAULT_SCENE_DESIGN.layers.opacityFront,
};

const CURRENT_LEAN = DEFAULT_SCENE_DESIGN.layers.currentLean;

interface SpritePieceProps {
  piece: PlacedSprite;
  clock: SharedValue<number>;
}

function SpritePiece({ piece, clock }: SpritePieceProps) {
  // Async-loaded like every other Skia image source in this app — returns
  // null until decoded, same "render nothing yet" contract as
  // `decor-cache.ts`'s `getCachedDecor`.
  const image = useImage(SPRITE_SOURCES[piece.spriteId]);
  const swayPhase = piece.worldX * 0.05;
  const swayAmount = piece.swayHeight > 0 ? 0.07 : 0;
  const mirrorScale = piece.mirror ? -1 : 1;

  const transform = useDerivedValue(() => [
    { translateX: piece.worldX },
    { translateY: piece.worldY },
    { scaleX: mirrorScale },
    {
      skewX:
        (Math.sin(clock.value / 1500 + swayPhase) * swayAmount +
          (swayAmount > 0 ? currentAt(clock.value / 1000) * CURRENT_LEAN : 0)) *
        mirrorScale,
    },
  ]);

  if (!image) return null;
  const rect = Skia.XYWHRect(piece.rect.x, piece.rect.y, piece.rect.width, piece.rect.height);
  return (
    <Group transform={transform} opacity={LAYER_OPACITY[piece.layer]}>
      <SkiaImage image={image} rect={rect} fit="fill" />
    </Group>
  );
}

interface SpriteLayerProps {
  pieces: PlacedSprite[];
}

/** Sprite-mode counterpart to `scene-layers.tsx`'s `SceneLayerGroup` — same per-band grouping, same sway/current-lean transform, PNG source instead of a runtime bake. */
export function SpriteLayerGroup({ pieces }: SpriteLayerProps) {
  const clock = useClock();
  return (
    <>
      {pieces.map((piece) => (
        <SpritePiece key={piece.key} piece={piece} clock={clock} />
      ))}
    </>
  );
}

interface CanvasSizeProps {
  width: number;
  height: number;
}

// Sampled from the reference art's open-water area (scene.png's top style
// reference strip) — sprite mode's water reads noticeably brighter/more
// pastel-cyan than the procedural theme's default teal, so it gets its own
// gradient rather than reusing `DEFAULT_SCENE_DESIGN.water`.
const SPRITE_WATER_TOP = "#b8ecfa";
const SPRITE_WATER_MID = "#5ec3e0";
const SPRITE_WATER_BOTTOM = "#1a5f79";

/** Sprite mode's water — a static gradient (no caustic/god-ray shader) matching the reference art's brighter palette, since this mode has no procedural water pass of its own. */
export function SpriteWater({ width, height }: CanvasSizeProps) {
  return (
    <Rect x={0} y={0} width={width} height={height}>
      <LinearGradient
        start={vec(0, 0)}
        end={vec(0, height)}
        colors={[SPRITE_WATER_TOP, SPRITE_WATER_MID, SPRITE_WATER_BOTTOM]}
        positions={[0, 0.55, 1]}
      />
    </Rect>
  );
}

// Wider than the canvas on both edges so the parallax camera never pans
// past the sand into empty canvas — same reasoning as `water.tsx`'s
// `AquariumSubstrate`.
const OVERSCAN = 20;

// Sampled from `sand-patch.png`'s own solid area — the fill behind it (see
// `SpriteSubstrate` below) so the patch's rounded silhouette never shows
// water peeking through at the corners once stretched to the full canvas
// width.
const SAND_BASE_COLOR = "#efe0ba";
const SAND_BASE_COLOR_BOTTOM = "#cbb887";

/**
 * Sprite mode's ground: the painted sand piece stretched across the full
 * canvas width, REPLACING `water.tsx`'s procedural `AquariumSubstrate` — a
 * shader-textured sand under painted decor read as two mismatched surfaces
 * meeting at a seam, which is a large part of what made pieces look like
 * they were floating rather than resting on the ground.
 *
 * `sand-patch.png` is a rounded oval clump, not a straight strip — a flat
 * colour fill underneath (sampled from its own solid area) is what keeps
 * its curved top edge from reading as gaps of open water at the canvas
 * corners once stretched full-width.
 */
export function SpriteSubstrate({ width, height }: CanvasSizeProps) {
  const image = useImage(SPRITE_SOURCES.sandPatch);
  const sandHeight = sandHeightFor(height);
  const y = height - sandHeight;
  const overscanWidth = width + OVERSCAN * 2;
  // Overscanned the same as `rect` below — this fill is what shows while
  // the sand PNG is still decoding (first mount, or a remount if the
  // canvas briefly loses its measured size during a rotation), and the
  // substrate sits inside a `ParallaxGroup` that pans it a few px either
  // way. A fill sized to exactly `width` falls short of the true canvas
  // edge whenever the pan currently favours that side, showing a gap of
  // open water until the PNG finishes loading and covers it.
  const fillRect = Skia.XYWHRect(-OVERSCAN, y, overscanWidth, sandHeight);
  const rect = Skia.XYWHRect(-OVERSCAN, y, overscanWidth, sandHeight);
  return (
    <>
      <Rect x={fillRect.x} y={fillRect.y} width={fillRect.width} height={fillRect.height}>
        <LinearGradient
          start={vec(0, fillRect.y)}
          end={vec(0, fillRect.y + fillRect.height)}
          colors={[SAND_BASE_COLOR, SAND_BASE_COLOR_BOTTOM]}
        />
      </Rect>
      {image ? <SkiaImage image={image} rect={rect} fit="fill" /> : null}
    </>
  );
}
