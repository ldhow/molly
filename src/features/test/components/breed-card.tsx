import { Pressable, StyleSheet, Text, View } from "react-native";

import { FishPreview } from "@/shared/aquarium/render/fish-preview";
import { palette, radius, spacing } from "@/shared/constants/theme";
import { strainCode, type BreedRecipe } from "@/shared/fish/generated-breed";
import { formatRarity, RARITY_COLORS } from "@/shared/fish/rarity";
import type { FishTraits, LifeStage } from "@/shared/fish/types";

interface Props {
  recipe: BreedRecipe;
  traits: FishTraits;
  stage: LifeStage;
  saved: boolean;
  featured: boolean;
  onPress: () => void;
  onToggleSave: () => void;
}

const THUMB_W = 128;
const THUMB_H = 84;

/**
 * One generated breed as a tile.
 *
 * Uses `FishPreview` rather than `FishLayer` for a structural reason, not a
 * cosmetic one: `FishLayer` is a Skia element and only renders inside a
 * `<Canvas>`, so it can't be laid out in a scrolling RN grid. `FishPreview`
 * brings its own canvas and still bakes through `fish-cache.ts`, so these are
 * the real tank pixels, not a stand-in.
 *
 * The accent stripe down the left edge is deliberate: a bad generated palette
 * is much easier to spot as a flat colour bar than by squinting at a fish.
 */
export function BreedCard({
  recipe,
  traits,
  stage,
  saved,
  featured,
  onPress,
  onToggleSave,
}: Props) {
  const rarityColor = RARITY_COLORS[recipe.rarity.tier];
  return (
    <Pressable
      style={[
        styles.card,
        { borderLeftColor: recipe.accentColor },
        featured && styles.cardFeatured,
      ]}
      onPress={onPress}
    >
      <View style={styles.thumb}>
        <FishPreview traits={traits} stage={stage} width={THUMB_W} height={THUMB_H} />
      </View>
      <Text style={styles.name} numberOfLines={1}>
        {recipe.name}
      </Text>
      <View style={styles.metaRow}>
        <Text style={[styles.rarity, { color: rarityColor }]} numberOfLines={1}>
          {formatRarity(recipe.rarity)}
        </Text>
        <Pressable hitSlop={8} onPress={onToggleSave}>
          <Text style={saved ? styles.starOn : styles.starOff}>{saved ? "★" : "☆"}</Text>
        </Pressable>
      </View>
      <Text style={styles.sub} numberOfLines={1}>
        {recipe.pattern.type} · {strainCode(recipe.seed)}
      </Text>
      <View style={styles.swatches}>
        {[
          recipe.palette.back,
          recipe.palette.mid,
          recipe.palette.belly,
          recipe.palette.fin,
          recipe.palette.finRay,
        ].map((hex, i) => (
          <View key={`${hex}-${i}`} style={[styles.swatch, { backgroundColor: hex }]} />
        ))}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: THUMB_W + spacing.md,
    backgroundColor: palette.surface,
    borderRadius: radius.sm,
    borderLeftWidth: 4,
    padding: spacing.xs,
    gap: 2,
  },
  cardFeatured: { backgroundColor: palette.surfaceAlt },
  thumb: {
    width: THUMB_W,
    height: THUMB_H,
    borderRadius: radius.sm,
    overflow: "hidden",
    backgroundColor: palette.waterMid,
  },
  name: { color: palette.text, fontSize: 12, fontWeight: "700" },
  metaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  rarity: { fontSize: 10, fontWeight: "700", flex: 1 },
  starOn: { color: palette.warning, fontSize: 15 },
  starOff: { color: palette.textFaint, fontSize: 15 },
  sub: { color: palette.textFaint, fontSize: 10 },
  swatches: { flexDirection: "row", gap: 2, marginTop: 2 },
  swatch: { width: 14, height: 8, borderRadius: 2 },
});
