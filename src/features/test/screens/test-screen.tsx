import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Canvas } from "@shopify/react-native-skia";

import { FishLayer } from "@/shared/aquarium/render/fish-layer";
import { AquariumWater } from "@/shared/aquarium/render/water";
import { palette, radius, spacing } from "@/shared/constants/theme";
import { ScreenContainer } from "@/shared/components/screen-container";
import { useOwnedFish } from "@/shared/hooks/use-owned-fish";
import { useSceneArtStore } from "@/shared/store/scene-art-store";

import { useAddDevFishMutation } from "../api/use-add-dev-fish-mutation";
import { useRemoveDevFishMutation } from "../api/use-remove-dev-fish-mutation";
import { BreedCard } from "../components/breed-card";
import { BreedLabPanel } from "../components/breed-lab-panel";
import { Chip } from "../components/chip";
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
  const router = useRouter();
  const [heroSize, setHeroSize] = useState({ width: 0, height: 0 });
  const lab = useBreedLab();
  const { fish } = useOwnedFish();
  const addDevFish = useAddDevFishMutation();
  const removeDevFish = useRemoveDevFishMutation();
  const sceneArtMode = useSceneArtStore((s) => s.sceneArtMode);
  const setSceneArtMode = useSceneArtStore((s) => s.setSceneArtMode);

  return (
    <ScreenContainer>
      {/*
        Everything that mutates the real `sessions` table for convenience
        (fabricate/delete a tank fish) or flips a scene-art A/B toggle used
        to live inline on the Tank screen, gated behind `__DEV__` there. That
        put dev-only chrome in the same header a normal user sees the tank
        through. This screen is itself already `__DEV__`-only (see the tab's
        `href: __DEV__ ? undefined : null` in `(tabs)/_layout.tsx`), so it's
        the natural home: the Tank screen now shows only real features, and
        every fabricate/delete/toggle a developer needs lives in one place.
      */}
      <View style={styles.devToolsCard}>
        <Text style={styles.sectionTitle}>Tank dev tools</Text>
        <View style={styles.devRow}>
          <Pressable
            style={styles.devButton}
            onPress={() => addDevFish.mutate()}
            disabled={addDevFish.isPending}
          >
            <Text style={styles.devButtonText}>Add a fish</Text>
          </Pressable>
          <Pressable
            style={styles.devButton}
            onPress={() => removeDevFish.mutate()}
            disabled={removeDevFish.isPending || fish.length === 0}
          >
            <Text style={styles.devButtonText}>Remove a fish</Text>
          </Pressable>
          <Pressable style={styles.devButton} onPress={() => router.push("/tank-preview")}>
            <Text style={styles.devButtonText}>Preview animation</Text>
          </Pressable>
        </View>
        <View style={styles.devRow}>
          <Text style={styles.hint}>Scene art (2D V2 only):</Text>
          <Chip
            label="Procedural"
            active={sceneArtMode === "procedural"}
            onPress={() => setSceneArtMode("procedural")}
          />
          <Chip
            label="Sprites"
            active={sceneArtMode === "sprites"}
            onPress={() => setSceneArtMode("sprites")}
          />
        </View>
      </View>

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
  devToolsCard: {
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.md,
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  devRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.xs,
  },
  devButton: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  devButtonText: { color: palette.textFaint, fontSize: 11, fontWeight: "600" },
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
