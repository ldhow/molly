// Static, non-swimming preview of a non-molly creature — bakes through the
// exact same pipeline (`creatures/bake-creature.ts`) real tank art uses, so
// every preview surface shows the SAME art the tank will, not a separate
// reference-only rendering path.
//
// Every non-molly preview (home-screen picker, Fishdex card, Holding Tank
// tile) routes through this. There is no locked/silhouette mode here —
// callers show a "🔒"/"???" text treatment for a locked species instead (see
// `focus-home-screen.tsx`), mirroring how a locked species has no revealed
// variant to preview yet.
//
// Like `fish-preview.tsx`, this draws the bake through a plain `<Image>`
// rather than a Skia `<Canvas>` — see `baked-uri.ts` for why a static tile
// shouldn't own a native surface.

import { Image } from "expo-image";
import { PixelRatio, StyleSheet, View } from "react-native";

import { densityAwareDpr } from "@/shared/aquarium/core/bake";
import type { CreatureSpeciesId } from "@/shared/aquarium/creatures/bake-placeholder";
import {
  creatureSourceKey,
  getCachedCreatureSource,
} from "@/shared/aquarium/render/creature-cache";
import { useBakedSource } from "@/shared/aquarium/render/use-baked-source";

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
  // Deferred for the same reason as `fish-preview.tsx` — see that file.
  const source = useBakedSource(creatureSourceKey(speciesId, variant, dpr), () =>
    getCachedCreatureSource(speciesId, variant, dpr),
  );
  if (!source) return <View style={{ width, height }} />;

  return (
    <View style={[styles.frame, { width, height }]}>
      <Image
        source={source.uri}
        style={{ width: width * FIT_MARGIN, height: height * FIT_MARGIN }}
        contentFit="contain"
        transition={0}
        cachePolicy="memory"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { alignItems: "center", justifyContent: "center" },
});
