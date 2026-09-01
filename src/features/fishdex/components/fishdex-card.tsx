import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { FishPreview } from "@/shared/aquarium/render/fish-preview";
import { palette, radius, spacing } from "@/shared/constants/theme";
import { standardTraits } from "@/shared/fish/catalog";
import { formatRarity, RARITY_COLORS } from "@/shared/fish/rarity";
import type { ColorDef } from "@/shared/fish/types";
import { unlockHint } from "@/shared/fish/unlocks";
import { durationHint } from "@/shared/lib/roll";

const PREVIEW_W = 128;
const PREVIEW_H = 72;

type Props = {
  def: ColorDef;
  unlocked: boolean;
};

/**
 * `memo`'d for the same reason as `FishTile`: the preview is a real Skia
 * `Canvas`, and there is one card per colour (dozens). `useUnlocks` rebuilds
 * its `entries` array on every `["sessions"]` write — which the Sell Fish
 * screen triggers from on top of this still-mounted tab — but `def` is a
 * stable `COLOR_DEFS` reference and `unlocked` a boolean, so the whole grid
 * bails out unless a colour genuinely just unlocked.
 */
export const FishdexCard = memo(function FishdexCard({ def, unlocked }: Props) {
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
      {unlocked && durationHint(def.rarity) ? (
        <Text style={styles.durationHint}>{durationHint(def.rarity)}</Text>
      ) : null}
    </View>
  );
});

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
  durationHint: {
    color: palette.textFaint,
    fontSize: 10,
    fontWeight: "700",
    textAlign: "center",
  },
});
