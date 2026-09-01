"use no memo"; // Reads a clock SharedValue inside useDerivedValue per piece —
// same "use no memo" reasoning as fish-layer.tsx.

import { Group, Skia, Image as SkiaImage, useClock } from "@shopify/react-native-skia";
import { useDerivedValue, type SharedValue } from "react-native-reanimated";

import type { PlacedPiece } from "../scene/compose";
import { DEFAULT_SCENE_DESIGN } from "../scene/scene-design";
import { currentAt } from "../sim/swim";
import { getCachedDecor } from "./decor-cache";

interface DecorPieceProps {
  piece: PlacedPiece;
  clock: SharedValue<number>;
}

/**
 * Atmospheric perspective: farther (back-layer) decor renders a touch
 * dimmer/more transparent — a cheap depth cue. Plain per-pixel opacity, not
 * a blend-mode tint rect: a tint rect paints its own full bounding box
 * regardless of the piece's actual (non-rectangular) silhouette, which
 * shows up as a visible box rather than a tinted plant/rock.
 */
const LAYER_OPACITY: Record<PlacedPiece["layer"], number> = {
  far: DEFAULT_SCENE_DESIGN.layers.opacityFar,
  back: DEFAULT_SCENE_DESIGN.layers.opacityBack,
  backMid: DEFAULT_SCENE_DESIGN.layers.opacityBackMid,
  mid: DEFAULT_SCENE_DESIGN.layers.opacityMid,
  frontMid: DEFAULT_SCENE_DESIGN.layers.opacityFrontMid,
  front: DEFAULT_SCENE_DESIGN.layers.opacityFront,
  frontMost: DEFAULT_SCENE_DESIGN.layers.opacityFrontMost,
};

/**
 * How far a swaying piece leans with the shared tank current, on top of its
 * own faster individual flutter. Slightly under the flutter amplitude (0.07)
 * so a plant still reads as fluttering in the flow rather than being
 * rigidly pushed by it.
 */
const CURRENT_LEAN = DEFAULT_SCENE_DESIGN.layers.currentLean;

function bakedRect(baked: NonNullable<ReturnType<typeof getCachedDecor>>) {
  return Skia.XYWHRect(baked.bounds.x, baked.bounds.y, baked.bounds.width, baked.bounds.height);
}

/**
 * Hardscape and ground cover — `swayHeight === 0`, so the transform is
 * CONSTANT. Split out of `SwayingDecorPiece` because that one carries a
 * `useDerivedValue` that reads the clock every frame, and `scene/backdrop.ts`
 * put ~60 more pieces on screen, most of them rocks, pebbles, mounds, carpet
 * and driftwood. Paying for a per-frame worklet to recompute a value that
 * never changes, sixty times a frame, is the kind of cost that doesn't show
 * up in any single profile line.
 */
function StaticDecorPiece({ piece }: { piece: PlacedPiece }) {
  const baked = getCachedDecor(piece);
  if (!baked) return null;
  return (
    <Group
      transform={[{ translateX: piece.worldX }, { translateY: piece.worldY }]}
      opacity={LAYER_OPACITY[piece.layer]}
    >
      <SkiaImage image={baked.image} rect={bakedRect(baked)} fit="fill" />
    </Group>
  );
}

function SwayingDecorPiece({ piece, clock }: DecorPieceProps) {
  const baked = getCachedDecor(piece);
  const swayPhase = piece.seed * 1.7;

  const transform = useDerivedValue(() => [
    { translateX: piece.worldX },
    { translateY: piece.worldY },
    {
      // Two terms: a fast per-piece flutter (own phase, so plants never move
      // in lockstep) plus a slow lean on the SAME current signal that
      // advects the fish (`currentAt`) — the plants and the fish visibly
      // respond to one flow, which is what sells "one body of water" far
      // more than the fish drift does on its own.
      skewX:
        Math.sin(clock.value / 1500 + swayPhase) * 0.07 +
        currentAt(clock.value / 1000) * CURRENT_LEAN,
    },
  ]);

  if (!baked) return null;
  return (
    <Group transform={transform} opacity={LAYER_OPACITY[piece.layer]}>
      <SkiaImage image={baked.image} rect={bakedRect(baked)} fit="fill" />
    </Group>
  );
}

interface SceneLayerProps {
  pieces: PlacedPiece[];
}

/** All decor pieces for one depth band (back/mid/front) — see aquarium-canvas.tsx for the interleave order. */
export function SceneLayerGroup({ pieces }: SceneLayerProps) {
  const clock = useClock();
  return (
    <>
      {/* Branch is stable per key — `swayHeight` is a property of the piece's
          generated art, not of any render-time state — so this can't swap a
          hook-using component for a hookless one under the same key. */}
      {pieces.map((piece) =>
        piece.swayHeight > 0 ? (
          <SwayingDecorPiece key={piece.key} piece={piece} clock={clock} />
        ) : (
          <StaticDecorPiece key={piece.key} piece={piece} />
        ),
      )}
    </>
  );
}
