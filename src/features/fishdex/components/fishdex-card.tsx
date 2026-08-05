import { Canvas, Group } from "@shopify/react-native-skia";
import { StyleSheet, Text, View } from "react-native";

import type { FishVariant } from "@/shared/fish/types";
import { unlockHint } from "@/shared/fish/unlocks";
import { FishBody } from "@/shared/components/tank/fish-sprite";
import { palette, radius, spacing } from "@/shared/constants/theme";

const PREVIEW_W = 128;
const PREVIEW_H = 72;

type Props = {
  variant: FishVariant;
  unlocked: boolean;
};

export function FishdexCard({ variant, unlocked }: Props) {
  return (
    <View style={[styles.card, !unlocked && styles.lockedCard]}>
      <Canvas style={styles.canvas}>
        <Group
          transform={[
            { translateX: PREVIEW_W / 2 },
            { translateY: PREVIEW_H / 2 },
            { scale: 0.52 },
          ]}
        >
          <FishBody variant={variant} stage="adult" clock={null} phase={0} silhouette={!unlocked} />
        </Group>
      </Canvas>
      <Text style={styles.name}>{unlocked ? variant.name : "???"}</Text>
      <Text style={styles.hint} numberOfLines={3}>
        {unlocked ? variant.description : unlockHint(variant.unlock)}
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
  hint: {
    color: palette.textFaint,
    fontSize: 11,
    textAlign: "center",
    lineHeight: 15,
  },
});
