"use no memo"; // Reads a clock SharedValue inside useDerivedValue per piece —
// same "use no memo" reasoning as scene-layers.tsx.

import {
  Group,
  LinearGradient,
  Rect,
  Skia,
  Image as SkiaImage,
  useClock,
  Shader,
  useImage,
  vec,
  type SkImage,
} from "@shopify/react-native-skia";
import { useMemo } from "react";
import { useDerivedValue, type SharedValue } from "react-native-reanimated";

import { sandHeightFor } from "@/shared/constants/tank";
import { parseHex } from "@/shared/lib/color";

import { getSubstrateEffect } from "../core/sksl/substrate";
import { getWaterEffect } from "../core/sksl/water";

import type { PlacedSprite } from "../scene/compose-sprites";
import { DEFAULT_SCENE_DESIGN } from "../scene/scene-design";
import { SCENE_SPRITES, type SpriteId } from "../scene/sprites/sprite-manifest";
import { SPRITE_SOURCES } from "../scene/sprites/sprite-sources";
import { currentAt } from "../sim/swim";

// Same atmospheric-perspective table as scene-layers.tsx's LAYER_OPACITY —
// duplicated rather than imported so sprite mode has no dependency on the
// procedural render module (the two art modes stay independent seams).
const LAYER_OPACITY: Record<PlacedSprite["layer"], number> = {
  far: DEFAULT_SCENE_DESIGN.layers.opacityFar,
  back: DEFAULT_SCENE_DESIGN.layers.opacityBack,
  backMid: DEFAULT_SCENE_DESIGN.layers.opacityBackMid,
  mid: DEFAULT_SCENE_DESIGN.layers.opacityMid,
  frontMid: DEFAULT_SCENE_DESIGN.layers.opacityFrontMid,
  front: DEFAULT_SCENE_DESIGN.layers.opacityFront,
  frontMost: DEFAULT_SCENE_DESIGN.layers.opacityFrontMost,
};

/**
 * How far a layer's colour is pulled toward the water haze — the OTHER half
 * of atmospheric perspective, and the half this renderer was missing.
 *
 * Alpha alone does not make something look far away. A back-layer piece at
 * `opacityFar` over a bright water gradient does not recede; it goes
 * translucent, letting the background show straight through its middle, and
 * reads as a semi-transparent decal floating in front of the water rather
 * than as an object sitting in it. That is the "pieces detach from the
 * background as they recede" failure exactly.
 *
 * What actually happens underwater is that intervening water SCATTERS light
 * into the line of sight: a distant object stays opaque but loses contrast
 * and shifts toward the water's own colour. So the fix is a colour pull, not
 * more transparency — and once the pull carries the depth cue, the opacity
 * reduction can be dialled back hard (see `hazedOpacity`), which is what
 * stops far pieces looking see-through.
 */
const LAYER_HAZE: Record<PlacedSprite["layer"], number> = {
  far: 0.62,
  back: 0.4,
  backMid: 0.24,
  mid: 0.1,
  frontMid: 0.04,
  front: 0,
  frontMost: 0,
};

/**
 * The colour distance pieces are hazed toward.
 *
 * Deliberately NOT `SPRITE_WATER_TOP`: decor sits in the lower half of the
 * frame, so the water actually behind a plant is the mid/bottom tone, and
 * hazing toward the pale surface colour would make far pieces read as
 * back-LIT rather than far away. Sampled between mid and bottom.
 */
const HAZE_RGB = hexToUnit(DEFAULT_SCENE_DESIGN.layers.hazeColor);

/**
 * With the haze carrying the depth cue, opacity only has to soften an edge —
 * so it is compressed toward 1 rather than used raw. `0.45` for `far` became
 * `~0.78` here, which is the single biggest reason far pieces stop looking
 * cut out.
 */
function hazedOpacity(layer: PlacedSprite["layer"]): number {
  return 1 - (1 - LAYER_OPACITY[layer]) * DEFAULT_SCENE_DESIGN.layers.hazeOpacityRelief;
}

/**
 * `out.rgb = in.rgb * (1 - k) + haze * k`, alpha untouched — an affine
 * colour op, so it fits a 4x5 colour matrix exactly and costs one filter
 * rather than a second draw of the same image.
 */
function hazeMatrix(k: number): number[] {
  const inv = 1 - k;
  return [
    inv, 0, 0, 0, HAZE_RGB[0] * k,
    0, inv, 0, 0, HAZE_RGB[1] * k,
    0, 0, inv, 0, HAZE_RGB[2] * k,
    0, 0, 0, 1, 0,
  ];
}

/** One paint per layer, built once — a `<Paint>` element per piece per frame would allocate on every tick. */
const HAZE_PAINT: Partial<Record<PlacedSprite["layer"], ReturnType<typeof Skia.Paint>>> = {};
for (const layer of Object.keys(LAYER_HAZE) as PlacedSprite["layer"][]) {
  const k = LAYER_HAZE[layer];
  if (k <= 0) continue;
  const paint = Skia.Paint();
  paint.setColorFilter(Skia.ColorFilter.MakeMatrix(hazeMatrix(k)));
  HAZE_PAINT[layer] = paint;
}

const CURRENT_LEAN = DEFAULT_SCENE_DESIGN.layers.currentLean;

/** Every sprite id, in a fixed order — the hook loop below depends on this being constant across renders. */
const SPRITE_IDS = Object.keys(SCENE_SPRITES) as SpriteId[];

type SpriteImages = Partial<Record<SpriteId, SkImage>>;

/**
 * Loads each DISTINCT sprite once for the whole layer group.
 *
 * `SpritePiece` used to call `useImage` itself, which was fine when the
 * theme was ~30 hand-placed pieces over ~20 sprites. `scene/backdrop-
 * sprites.ts` puts ~100 on screen, and since the fill reuses the same PNGs
 * many times over, per-piece loading meant ~100 loads of ~20 files — the
 * same decode repeated five times on average, and a fresh one every time a
 * piece mounted.
 *
 * The loop is a fixed-length map over a module-level constant, so the hook
 * count and order never vary between renders. That is what makes calling a
 * hook in a loop legal here; it would NOT be if it iterated the pieces.
 */
function useSpriteImages(): SpriteImages {
  const images: SpriteImages = {};
  for (const id of SPRITE_IDS) {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- fixed-length loop over a module constant; see this function's doc.
    const image = useImage(SPRITE_SOURCES[id]);
    if (image) images[id] = image;
  }
  return images;
}

interface SpritePieceProps {
  piece: PlacedSprite;
  image: SkImage | undefined;
  clock: SharedValue<number>;
}

function SpritePiece({ piece, image, clock }: SpritePieceProps) {
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

  // Null until decoded — same "render nothing yet" contract as
  // `decor-cache.ts`'s `getCachedDecor`.
  if (!image) return null;
  const rect = Skia.XYWHRect(piece.rect.x, piece.rect.y, piece.rect.width, piece.rect.height);
  const haze = HAZE_PAINT[piece.layer];
  return (
    <Group transform={transform} opacity={hazedOpacity(piece.layer)}>
      <SkiaImage image={image} rect={rect} fit="fill" paint={haze} />
    </Group>
  );
}

interface SpriteLayerProps {
  pieces: PlacedSprite[];
}

/** Sprite-mode counterpart to `scene-layers.tsx`'s `SceneLayerGroup` — same per-band grouping, same sway/current-lean transform, PNG source instead of a runtime bake. */
export function SpriteLayerGroup({ pieces }: SpriteLayerProps) {
  const clock = useClock();
  const images = useSpriteImages();
  return (
    <>
      {pieces.map((piece) => (
        <SpritePiece key={piece.key} piece={piece} image={images[piece.spriteId]} clock={clock} />
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
/** `#rrggbb` -> float3 in 0-1, the form every SkSL colour uniform here wants. */
function hexToUnit(hex: string): number[] {
  const rgb = parseHex(hex) ?? [0, 0, 0];
  return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
}

// Darkened from the reference-sampled #b8ecfa / #5ec3e0 / #1a5f79.
//
// The old top tone sat at ~0.87 luminance — near white. Fish are drawn OVER
// this, so a mid-tone fish against a near-white field had almost no value
// contrast to separate it, and the tank read as a bright background with the
// subject lost inside it. Pulling the top down and deepening the bottom
// widens the value range the fish occupy, without abandoning the painted
// palette's hue — still a pastel cyan, just no longer competing with the
// thing it is supposed to frame.
const SPRITE_WATER_TOP = "#7fc4dc";
const SPRITE_WATER_MID = "#3f93b4";
const SPRITE_WATER_BOTTOM = "#123f56";

/** The same three, as float3 (0-1) for the shared water shader's uniforms. */
const SPRITE_WATER_TOP_RGB = hexToUnit(SPRITE_WATER_TOP);
const SPRITE_WATER_MID_RGB = hexToUnit(SPRITE_WATER_MID);
const SPRITE_WATER_BOTTOM_RGB = hexToUnit(SPRITE_WATER_BOTTOM);

/**
 * Sprite mode's water — now the SAME fullscreen shader the procedural mode
 * uses, fed this mode's own palette through its colour uniforms, rather than
 * the static gradient it used to be.
 *
 * A flat vertical gradient states "brighter at the top" and nothing more,
 * which is why this mode had no readable light DIRECTION: nothing in frame
 * said where the light came from, so the decor's own baked-in shading had
 * nothing to agree with and every piece looked lit by a different sun. The
 * shared shader carries drifting god-ray shafts and a caustic shimmer, and
 * the shafts ARE the cue — they establish a source above and to one side,
 * which is what the rest of the art is already lit for (see
 * `DEFAULT_SCENE_DESIGN.lighting`).
 *
 * One fullscreen draw either way. The gradient fallback is kept for the same
 * reason `water.tsx` keeps one: a device where the runtime effect fails to
 * compile still gets water.
 */
export function SpriteWater({ width, height }: CanvasSizeProps) {
  const clock = useClock();
  const effect = getWaterEffect(Skia);

  const uniforms = useDerivedValue<Record<string, number | number[]>>(() => ({
    width,
    height,
    time: clock.value / 1000,
    colorTop: SPRITE_WATER_TOP_RGB,
    colorMid: SPRITE_WATER_MID_RGB,
    colorBottom: SPRITE_WATER_BOTTOM_RGB,
  }));

  if (!effect) {
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
  return (
    <Rect x={0} y={0} width={width} height={height}>
      <Shader source={effect} uniforms={uniforms} />
    </Rect>
  );
}

// Wider than the canvas on both edges so the parallax camera never pans
// past the sand into empty canvas — same reasoning as `water.tsx`'s
// `AquariumSubstrate`.
const OVERSCAN = 20;

// Sprite mode's sand palette, as float3 (0-1) for `core/sksl/substrate.ts`.
// Warmer and lighter than the procedural theme's — this mode's whole palette
// is the brighter painted one, sampled from `assets/images/scene/scene.png`,
// where the seabed is a pale warm tan rather than the pond-silt colour the
// 2D theme uses.
const SPRITE_SAND_TOP = [0.906, 0.843, 0.702] as const;
const SPRITE_SAND_BOTTOM = [0.757, 0.663, 0.51] as const;
const SPRITE_SAND_SPECKLE = [0.494, 0.416, 0.298] as const;
/** Sand is grainier here than in the procedural theme: the painted art it sits under has visible texture everywhere, so a smooth floor under it reads as the odd one out. */
const SPRITE_SAND_GRAIN = 0.055;
const SPRITE_SAND_SPECKLE_DENSITY = 0.14;

/** Fallback gradient stops, used only if the runtime effect fails to compile. */
const SAND_BASE_COLOR = "#e7d7b3";
const SAND_BASE_COLOR_BOTTOM = "#c1a982";

/**
 * The sand/water seam. A substrate that meets the water on a perfectly hard
 * horizontal line reads as two rectangles stacked, which is half of what made
 * the old ground look pasted on; a short shadow band fading down into the
 * sand is what makes the water look like it's sitting ON the floor.
 */
const SAND_SEAM_SHADOW = "rgba(52, 74, 84, 0.34)";
const SAND_SEAM_FRACTION = 0.42;

/**
 * Peak-to-centre wobble of the sand's top edge, px, capped so it stays small
 * relative to the band. A substrate whose surface is a perfectly straight
 * horizontal rule is the other half of what read as fake — real sand settles
 * into a slightly uneven bed. Kept under the smallest `LAYER_SINK_PX` so a
 * trough can never expose the foot of a piece resting on the line.
 */
const SAND_WAVE_MAX = 5;

/**
 * The sand body as a path with an undulating top edge — two sine terms at
 * incommensurate frequencies, so the wobble never repeats visibly across the
 * width and needs no rng (this has to be stable across renders).
 *
 * Overscanned to match the substrate rect: it sits in a `ParallaxGroup` that
 * pans it a few px either way.
 */
function useSandPath(width: number, height: number, sandHeight: number, y: number) {
  return useMemo(() => {
    const path = Skia.Path.Make();
    const left = -OVERSCAN;
    const right = width + OVERSCAN;
    const amp = Math.min(SAND_WAVE_MAX, sandHeight * 0.14);
    const STEPS = 64;
    path.moveTo(left, height);
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      const px = left + (right - left) * t;
      const wave = Math.sin(t * Math.PI * 3.1) * 0.6 + Math.sin(t * Math.PI * 7.7 + 1.7) * 0.4;
      path.lineTo(px, y + wave * amp);
    }
    path.lineTo(right, height);
    path.close();
    return path;
  }, [width, height, sandHeight, y]);
}

/**
 * Sprite mode's ground.
 *
 * This used to stretch `sand-patch.png` across the whole canvas width, and
 * that is what made the seabed look fake. OPEN THAT ASSET before considering
 * going back: it is a small rounded OVAL PATCH of sand carrying eight big
 * painted pebble blobs — a decorative piece you scatter, not a floor. Pulled
 * edge to edge it blew those eight blobs up into huge, evenly spaced dark
 * ellipses, smeared the grain horizontally (421px of art across an 844px
 * canvas), and stretched its oval silhouette into a lens. One small sprite
 * pretending to be a whole seabed.
 *
 * So the ground is procedural again — the SAME `core/sksl/substrate.ts`
 * shader the 2D theme uses (gradient + per-pixel grain + sparse grit
 * specks), which is resolution-independent, never stretches, and costs one
 * draw call. Only the palette and the grain/speckle amounts differ; see the
 * constants above. `sandPatch` stays in the manifest as a placeable decor
 * piece, which is what it was always meant to be.
 */
export function SpriteSubstrate({ width, height }: CanvasSizeProps) {
  const sandHeight = sandHeightFor(height);
  const y = height - sandHeight;
  const effect = getSubstrateEffect(Skia);
  // Overscanned because the substrate sits inside a `ParallaxGroup` that pans
  // it a few px either way; sized to exactly `width` it falls short of the
  // canvas edge whenever the pan favours that side.
  const overscanWidth = width + OVERSCAN * 2;
  const sandPath = useSandPath(width, height, sandHeight, y);

  const uniforms = useDerivedValue<Record<string, number | readonly number[]>>(() => ({
    width: overscanWidth,
    height: sandHeight,
    colorTop: SPRITE_SAND_TOP,
    colorBottom: SPRITE_SAND_BOTTOM,
    speckleColor: SPRITE_SAND_SPECKLE,
    grainStrength: SPRITE_SAND_GRAIN,
    speckleDensity: SPRITE_SAND_SPECKLE_DENSITY,
  }));

  // Both the sand and its seam shadow are clipped to the same wavy path, so
  // the shadow follows the surface instead of cutting across it.
  return (
    <Group clip={sandPath}>
      {effect ? (
        <Group transform={[{ translateY: y - SAND_WAVE_MAX }]}>
          <Rect x={-OVERSCAN} y={0} width={overscanWidth} height={sandHeight + SAND_WAVE_MAX}>
            <Shader source={effect} uniforms={uniforms} />
          </Rect>
        </Group>
      ) : (
        <Rect
          x={-OVERSCAN}
          y={y - SAND_WAVE_MAX}
          width={overscanWidth}
          height={sandHeight + SAND_WAVE_MAX}
        >
          <LinearGradient
            start={vec(0, y)}
            end={vec(0, y + sandHeight)}
            colors={[SAND_BASE_COLOR, SAND_BASE_COLOR_BOTTOM]}
          />
        </Rect>
      )}
      <Rect
        x={-OVERSCAN}
        y={y - SAND_WAVE_MAX}
        width={overscanWidth}
        height={sandHeight * SAND_SEAM_FRACTION + SAND_WAVE_MAX}
      >
        <LinearGradient
          start={vec(0, y - SAND_WAVE_MAX)}
          end={vec(0, y + sandHeight * SAND_SEAM_FRACTION)}
          colors={[SAND_SEAM_SHADOW, "rgba(52, 74, 84, 0)"]}
        />
      </Rect>
    </Group>
  );
}
