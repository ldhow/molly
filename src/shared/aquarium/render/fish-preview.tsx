// Static, non-swimming preview of a molly — bakes through the exact same
// pipeline (`fish/bake-fish.ts` via `fish-cache.ts`) real tank art uses, same
// role `creature-preview.tsx` plays for the other 5 species. There is no
// locked/silhouette mode here, same as `creature-preview.tsx` — callers show
// a "🔒"/"???" text treatment for a locked color instead.

import { Canvas, Group, Image as SkiaImage } from "@shopify/react-native-skia";
import { PixelRatio, View } from "react-native";

import { densityAwareDpr } from "@/shared/aquarium/core/bake";
import type { FishTraits, LifeStage } from "@/shared/fish/types";

import { getCachedFish } from "./fish-cache";

interface Props {
  traits: FishTraits;
  stage: LifeStage;
  width: number;
  height: number;
}

/** Baked at a fixed, generous scale — a static preview never shrinks the way a tank-mode swimmer does. */
const PREVIEW_RENDER_SCALE = 1.6;
/** Leaves breathing room around the fish so it doesn't touch the card edge. */
const FIT_MARGIN = 0.82;

export function FishPreview({ traits, stage, width, height }: Props) {
  const dpr = densityAwareDpr(PixelRatio.get(), PREVIEW_RENDER_SCALE);
  const baked = getCachedFish(traits, stage, dpr);
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
