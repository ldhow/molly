// Static, non-swimming preview of a molly — bakes through the exact same
// pipeline (`fish/bake-fish.ts` via `fish-cache.ts`) real tank art uses, same
// role `creature-preview.tsx` plays for the other 5 species. `locked` swaps
// to a flat, colour-blind silhouette bake (`getCachedFishSilhouette`) — for
// Fishdex entries the player hasn't unlocked yet.
//
// Renders that bake through a plain `<Image>`, NOT a Skia `<Canvas>`. A
// Canvas here used to make every grid tile its own native view with its own
// EGL window surface, which is what made screens full of these expensive to
// open and to reflow — see `baked-uri.ts` for the full reasoning. The art is
// identical; only the surface it is shown on changed.

import { Image } from "expo-image";
import { PixelRatio, StyleSheet, View } from "react-native";

import { densityAwareDpr } from "@/shared/aquarium/core/bake";
import type { FishTraits, LifeStage } from "@/shared/fish/types";

import {
  fishSilhouetteSourceKey,
  fishSourceKey,
  getCachedFishSilhouetteSource,
  getCachedFishSource,
} from "./fish-cache";
import { useBakedSource } from "./use-baked-source";

interface Props {
  traits: FishTraits;
  stage: LifeStage;
  width: number;
  height: number;
  /** Draw the real shape as a flat, colour-blind silhouette instead of its actual bake — see file header. */
  locked?: boolean;
}

/** Baked at a fixed, generous scale — a static preview never shrinks the way a tank-mode swimmer does. */
const PREVIEW_RENDER_SCALE = 1.6;
/** Leaves breathing room around the fish so it doesn't touch the card edge. */
const FIT_MARGIN = 0.82;

export function FishPreview({ traits, stage, width, height, locked = false }: Props) {
  const dpr = densityAwareDpr(PixelRatio.get(), PREVIEW_RENDER_SCALE);
  // Deferred, not computed inline: baking + PNG-encoding every tile of a grid
  // inside one synchronous render is what made these screens slow to open.
  // The box below is sized the same either way, so a tile never reflows when
  // its art lands — see `use-baked-source.ts`.
  const source = useBakedSource(
    locked ? fishSilhouetteSourceKey(traits, dpr) : fishSourceKey(traits, stage, dpr),
    () =>
      locked ? getCachedFishSilhouetteSource(traits, dpr) : getCachedFishSource(traits, stage, dpr),
  );
  if (!source) return <View style={{ width, height }} />;

  return (
    <View style={[styles.frame, { width, height }]}>
      <Image
        source={source.uri}
        // `contain` inside a box already inset by FIT_MARGIN reproduces what
        // the Canvas version computed by hand as
        // `min(w/bw, h/bh) * FIT_MARGIN`.
        style={{ width: width * FIT_MARGIN, height: height * FIT_MARGIN }}
        contentFit="contain"
        // No cross-fade and memory-only caching: these are small, already in
        // RAM as a data URI, and re-shown constantly as grids scroll — a
        // transition would read as tiles flickering, and a disk cache would
        // be writing bytes we already hold.
        transition={0}
        cachePolicy="memory"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { alignItems: "center", justifyContent: "center" },
});
