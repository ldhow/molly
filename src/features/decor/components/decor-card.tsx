import { Image } from "expo-image";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { SPRITE_SOURCES } from "@/shared/aquarium";
import { palette, radius, spacing } from "@/shared/constants/theme";
import type { DecorItemDef } from "@/shared/decor/types";
import { formatRarity, RARITY_COLORS } from "@/shared/fish/rarity";

interface Props {
  def: DecorItemDef;
  owned: number;
  affordable: boolean;
  onBuy: () => void;
  buying: boolean;
}

export function DecorCard({ def, owned, affordable, onBuy, buying }: Props) {
  const rarityColor = RARITY_COLORS[def.rarity.tier];
  return (
    <View style={styles.card}>
      <View style={styles.thumbWrap}>
        <Image
          source={SPRITE_SOURCES[def.id]}
          style={styles.thumb}
          contentFit="contain"
          accessibilityLabel={def.name}
        />
        {owned > 0 ? (
          <View style={styles.ownedBadge}>
            <Text style={styles.ownedBadgeText}>×{owned}</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.name}>{def.name}</Text>
      <Text style={[styles.rarity, { color: rarityColor }]}>{formatRarity(def.rarity)}</Text>
      <Text style={styles.description} numberOfLines={2}>
        {def.description}
      </Text>
      <Pressable
        style={[styles.buyButton, (!affordable || buying) && styles.buyButtonDisabled]}
        onPress={onBuy}
        disabled={!affordable || buying}
      >
        <Text style={styles.buyButtonText}>🪙 {def.price}</Text>
      </Pressable>
    </View>
  );
}

const THUMB_SIZE = 96;

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.md,
    alignItems: "center",
    gap: spacing.xs,
  },
  thumbWrap: { width: THUMB_SIZE, height: THUMB_SIZE },
  thumb: { width: THUMB_SIZE, height: THUMB_SIZE },
  ownedBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    backgroundColor: palette.accentDark,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  ownedBadgeText: { color: palette.text, fontSize: 10, fontWeight: "800" },
  name: { color: palette.text, fontSize: 14, fontWeight: "700" },
  rarity: { fontSize: 10, fontWeight: "800" },
  description: {
    color: palette.textFaint,
    fontSize: 11,
    textAlign: "center",
    lineHeight: 15,
  },
  buyButton: {
    marginTop: spacing.xs,
    backgroundColor: palette.accent,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  buyButtonDisabled: { opacity: 0.4 },
  buyButtonText: { color: "#03222f", fontSize: 13, fontWeight: "700" },
});
