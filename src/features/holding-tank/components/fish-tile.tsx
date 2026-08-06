import { Canvas, Group } from "@shopify/react-native-skia";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { SessionRow } from "@/db/schema";
import { FishBody } from "@/shared/components/tank/fish-sprite";
import { STAGE_SCALE } from "@/shared/constants/tank";
import { palette, radius, spacing } from "@/shared/constants/theme";
import { getColorDef, traitsOfRow } from "@/shared/fish/catalog";
import { stageForProgress } from "@/shared/fish/life-stage";
import type { LifeStage } from "@/shared/fish/types";
import { formatMinutes } from "@/shared/lib/dates";

const PREVIEW_W = 128;
const PREVIEW_H = 72;
const PREVIEW_SCALE = 0.52;

interface Props {
  row: SessionRow;
  selected?: boolean;
  onPress: () => void;
}

/**
 * Static preview card for the Holding Tank grid. Passes `vector` so it draws
 * via `FishBody`'s declarative node path instead of `fish-picture.ts`'s baked
 * cache — a large archive can mount many distinct fish at once, and each one
 * baking to its own GPU offscreen texture corrupts rendering.
 */
export function FishTile({ row, selected, onPress }: Props) {
  const alive = row.outcome === "completed";
  const traits = traitsOfRow(row);
  const colorDef = getColorDef(traits.color);
  const stage: LifeStage = alive ? "adult" : stageForProgress(deathProgress(row));

  return (
    <Pressable style={[styles.card, selected && styles.selectedCard]} onPress={onPress}>
      <Canvas style={styles.canvas}>
        <Group
          transform={[
            { translateX: PREVIEW_W / 2 },
            { translateY: PREVIEW_H / 2 + 4 },
            { scale: PREVIEW_SCALE * STAGE_SCALE[stage] },
          ]}
        >
          <FishBody traits={traits} stage={stage} clock={null} phase={0} vector />
        </Group>
      </Canvas>
      <Text style={styles.name}>{colorDef.name}</Text>
      <View style={styles.metaRow}>
        <Text style={styles.status}>{alive ? "alive" : "dead"}</Text>
        <Text style={styles.meta}>
          {row.localDate} · {formatMinutes(row.plannedMinutes)}
        </Text>
      </View>
    </Pressable>
  );
}

/** How far through the planned session the fish got before it died. */
function deathProgress(row: SessionRow): number {
  const total = row.plannedMinutes * 60_000;
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, (row.endedAt - row.startedAt) / total));
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
  selectedCard: { borderColor: palette.accent },
  canvas: { width: PREVIEW_W, height: PREVIEW_H },
  name: { color: palette.text, fontSize: 14, fontWeight: "700" },
  metaRow: { alignItems: "center", gap: 2 },
  status: { color: palette.textFaint, fontSize: 10, fontWeight: "800", textTransform: "uppercase" },
  meta: { color: palette.textFaint, fontSize: 11 },
});
