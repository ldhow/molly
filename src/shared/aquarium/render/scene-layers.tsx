"use no memo"; // Reads a clock SharedValue inside useDerivedValue per piece —
// same "use no memo" reasoning as fish-layer.tsx.

import { Group, Skia, Image as SkiaImage, useClock } from "@shopify/react-native-skia";
import { useDerivedValue, type SharedValue } from "react-native-reanimated";

import type { PlacedPiece } from "../scene/compose";
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
const LAYER_OPACITY: Record<PlacedPiece["layer"], number> = { back: 0.7, mid: 1, front: 1 };

/**
 * How far a swaying piece leans with the shared tank current, on top of its
 * own faster individual flutter. Slightly under the flutter amplitude (0.07)
 * so a plant still reads as fluttering in the flow rather than being
 * rigidly pushed by it.
 */
const CURRENT_LEAN = 0.05;

function DecorPiece({ piece, clock }: DecorPieceProps) {
  const baked = getCachedDecor(piece);
  const swayPhase = piece.seed * 1.7;
  const swayAmount = piece.swayHeight > 0 ? 0.07 : 0;

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
        Math.sin(clock.value / 1500 + swayPhase) * swayAmount +
        (swayAmount > 0 ? currentAt(clock.value / 1000) * CURRENT_LEAN : 0),
    },
  ]);

  if (!baked) return null;
  const rect = Skia.XYWHRect(
    baked.bounds.x,
    baked.bounds.y,
    baked.bounds.width,
    baked.bounds.height,
  );
  return (
    <Group transform={transform} opacity={LAYER_OPACITY[piece.layer]}>
      <SkiaImage image={baked.image} rect={rect} fit="fill" />
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
      {pieces.map((piece) => (
        <DecorPiece key={piece.key} piece={piece} clock={clock} />
      ))}
    </>
  );
}
