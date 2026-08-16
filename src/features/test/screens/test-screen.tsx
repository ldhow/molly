import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Canvas } from "@shopify/react-native-skia";

import { FishLayer } from "@/shared/aquarium/render/fish-layer";
import { AquariumWater } from "@/shared/aquarium/render/water";
import { palette, radius, spacing } from "@/shared/constants/theme";
import { ScreenContainer } from "@/shared/components/screen-container";

import { BreedCard } from "../components/breed-card";
import { BreedLabPanel } from "../components/breed-lab-panel";
import { TraitToggles } from "../components/trait-toggles";
import { useBreedLab } from "../hooks/use-breed-lab";

/** Height of the live swim strip. Tall enough that the spine warp is legible. */
const HERO_HEIGHT = 170;

/**
 * Dev-only breed lab.
 *
 * Molly's 16 hand-authored colours are a closed list; `generated-breed.ts`
 * mints new ones procedurally, where the `gen:<seed>` id IS the whole recipe.
 * This screen is where those get judged before any of them reach the game —
 * roll batches, keep the good ones (persisted, so a good seed survives a
 * reload), and check a breed against the anatomy and life stages it will
 * actually be rolled onto.
 *
 * One fish swims (motion is the thing a static tile can't show, and the water
 * behind it is the exact background the generator's contrast floors are tuned
 * against); the rest are static bakes, because 12 live warp shaders would be
 * paying for animation nobody is looking at.
 */
export function TestScreen() {
  const [heroSize, setHeroSize] = useState({ width: 0, height: 0 });
  const lab = useBreedLab();

  return (
    <ScreenContainer>
      <View
        style={styles.hero}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          setHeroSize({ width, height });
        }}
      >
        <Canvas style={StyleSheet.absoluteFill}>
          <AquariumWater width={heroSize.width} height={heroSize.height} />
          {heroSize.width > 0 ? (
            <FishLayer
              // Remounts the swim state when the featured breed changes, so
              // the new fish enters instead of teleporting mid-stroke.
              key={lab.heroRecipe.id}
              traits={lab.traitsFor(lab.heroSeed)}
              stage={lab.stage}
              status="alive"
              bounds={heroSize}
              scale={1}
              seed={0.5}
              mode="tank"
              depth={0.5}
              band="mid"
            />
          ) : null}
        </Canvas>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <BreedLabPanel
          heroRecipe={lab.heroRecipe}
          heroSeed={lab.heroSeed}
          onRollBatch={lab.rollBatch}
          onRollOne={lab.rollOne}
          onFocusSeed={lab.focusSeedInput}
        />

        <TraitToggles
          stage={lab.stage}
          body={lab.body}
          tail={lab.tail}
          dorsal={lab.dorsal}
          patternSeed={lab.patternSeed}
          patternSeedBuckets={lab.patternSeedBuckets}
          onStage={lab.setStage}
          onBody={lab.setBody}
          onTail={lab.setTail}
          onDorsal={lab.setDorsal}
          onPatternSeed={lab.setPatternSeed}
        />

        <Text style={styles.sectionTitle}>Rolled</Text>
        <View style={styles.grid}>
          {lab.rolled.map((recipe) => (
            <BreedCard
              key={recipe.id}
              recipe={recipe}
              traits={lab.traitsFor(recipe.seed)}
              stage={lab.stage}
              saved={!!lab.savedMap[recipe.id]}
              featured={lab.heroSeed === recipe.seed}
              onPress={() => lab.setHeroSeed(recipe.seed)}
              onToggleSave={() => lab.toggleSave(recipe)}
            />
          ))}
        </View>

        <Text style={styles.sectionTitle}>Kept ({lab.saved.length})</Text>
        {lab.saved.length === 0 ? (
          <Text style={styles.hint}>
            Tap ☆ on a breed to keep it. Kept breeds store their full recipe, so they survive a
            reload — and a later retune of the generator.
          </Text>
        ) : (
          <View style={styles.grid}>
            {lab.saved.map((recipe) => (
              <BreedCard
                key={recipe.id}
                recipe={recipe}
                traits={lab.traitsFor(recipe.seed)}
                stage={lab.stage}
                saved
                featured={lab.heroSeed === recipe.seed}
                onPress={() => lab.setHeroSeed(recipe.seed)}
                onToggleSave={() => lab.toggleSave(recipe)}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  hero: {
    height: HERO_HEIGHT,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: palette.waterBottom,
  },
  content: { paddingVertical: spacing.sm, gap: spacing.sm, paddingBottom: spacing.xl },
  sectionTitle: {
    color: palette.text,
    fontSize: 15,
    fontWeight: "700",
    marginTop: spacing.xs,
  },
  hint: { color: palette.textFaint, fontSize: 11 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
});
