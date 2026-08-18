import { StyleSheet, Text, View } from "react-native";

import { FishPreview } from "@/shared/aquarium/render/fish-preview";
import { palette, radius, spacing } from "@/shared/constants/theme";
import { standardTraits } from "@/shared/fish/catalog";
import { formatRarity, RARITY_COLORS } from "@/shared/fish/rarity";
import type { ColorDef } from "@/shared/fish/types";
import { unlockHint } from "@/shared/fish/unlocks";

const PREVIEW_W = 128;
const PREVIEW_H = 72;

type Props = {
  def: ColorDef;
  unlocked: boolean;
};

export function FishdexCard({ def, unlocked }: Props) {
  const rarityColor = RARITY_COLORS[def.rarity.tier];
  return (
    <View style={[styles.card, !unlocked && styles.lockedCard]}>
      <View style={styles.canvas}>
        <FishPreview
          traits={standardTraits(def.id)}
          stage="adult"
          width={PREVIEW_W}
          height={PREVIEW_H}
          locked={!unlocked}
        />
      </View>
      <Text style={styles.name}>{unlocked ? def.name : "???"}</Text>
      <Text style={[styles.rarity, { color: rarityColor }]}>{formatRarity(def.rarity)}</Text>
      <Text style={styles.hint} numberOfLines={3}>
        {unlocked ? def.description : unlockHint(def.unlock)}
      </Text>
    </View>
  );
}

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
  lockedCard: { opacity: 0.75 },
  canvas: { width: PREVIEW_W, height: PREVIEW_H },
  name: { color: palette.text, fontSize: 14, fontWeight: "700" },
  rarity: { fontSize: 10, fontWeight: "800" },
  hint: {
    color: palette.textFaint,
    fontSize: 11,
    textAlign: "center",
    lineHeight: 15,
  },
});
