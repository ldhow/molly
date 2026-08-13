// Static, non-swimming preview of a non-molly creature — bakes through the
// exact same pipeline (`creatures/bake-placeholder.ts` today,
// `creatures/<species>/bake-creature.ts` once real anatomy ships in Phase C)
// real tank art uses, so every preview surface shows the SAME art the tank
// will, not a separate reference-only rendering path.
//
// Molly previews keep using the legacy `FishBody` node component unchanged
// — zero risk to something that already works. Every non-molly preview
// (home-screen picker, Fishdex card, Holding Tank tile) routes through this
// instead, since those species have no legacy-renderer art to fall back to.
// There is no locked/silhouette mode here — callers show a "🔒"/"???" text
// treatment for a locked species instead (see `focus-home-screen.tsx`),
// mirroring how a locked species has no revealed variant to preview yet.

import { Canvas, Group, Image as SkiaImage } from "@shopify/react-native-skia";
import { PixelRatio, View } from "react-native";

import { densityAwareDpr } from "@/shared/aquarium/core/bake";
import type { CreatureSpeciesId } from "@/shared/aquarium/creatures/bake-placeholder";
import { getCachedCreature } from "@/shared/aquarium/render/creature-cache";

interface Props {
  speciesId: CreatureSpeciesId;
  variant: string;
  width: number;
  height: number;
}

/** Baked at a fixed, generous scale — a static preview never shrinks the way a tank-mode swimmer does. */
const PREVIEW_RENDER_SCALE = 1.6;
/** Leaves breathing room around the creature so it doesn't touch the card edge. */
const FIT_MARGIN = 0.82;

export function CreaturePreview({ speciesId, variant, width, height }: Props) {
  const dpr = densityAwareDpr(PixelRatio.get(), PREVIEW_RENDER_SCALE);
  const baked = getCachedCreature(speciesId, variant, dpr);
  if (!baked) return <View style={{ width, height }} />;

  const fitScale = Math.min(width / baked.bounds.width, height / baked.bounds.height) * FIT_MARGIN;
  const rect = {
    x: baked.bounds.x,
    y: baked.bounds.y,
    width: baked.bounds.width,
    height: baked.bounds.height,
  };

  return (
    <Canvas style={{ width, height }}>
      <Group
        transform={[{ translateX: width / 2 }, { translateY: height / 2 }, { scale: fitScale }]}
      >
        <SkiaImage image={baked.image} rect={rect} fit="fill" />
      </Group>
    </Canvas>
  );
}
