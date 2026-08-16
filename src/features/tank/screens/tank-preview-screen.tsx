import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TankView } from "@/shared/components/tank/tank-view";
import { palette, radius, spacing } from "@/shared/constants/theme";

import { mockAliveFish, mockDeadFish } from "../utils/mock-fish";

const COUNT_OPTIONS = [5, 15, 25] as const;
const DEAD_OPTIONS = [0, 3] as const;

/**
 * Dev-only: watch the tank's live swim animation — the same `TankView` code
 * the app ships (so it follows the renderer toggle too) — without a device
 * build or DB writes. Fish are generated in memory (see `mock-fish.ts`) and
 * thrown away on unmount. Reachable via the "DEV: preview animation" button
 * on the real Tank screen, or by navigating to /tank-preview directly.
 */
export function TankPreviewScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [aliveCount, setAliveCount] = useState<number>(15);
  const [deadCount, setDeadCount] = useState<number>(0);
  const [generation, setGeneration] = useState(0);

  const fish = useMemo(
    () => [...mockAliveFish(aliveCount), ...mockDeadFish(deadCount)],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [aliveCount, deadCount, generation],
  );

  return (
    <View style={styles.root}>
      <TankView fish={fish} style={StyleSheet.absoluteFill as never} />
      <View
        style={[
          styles.overlay,
          {
            paddingTop: insets.top + spacing.sm,
            paddingLeft: insets.left + spacing.md,
            paddingRight: insets.right + spacing.md,
          },
        ]}
      >
        <View style={styles.panel}>
          <View style={styles.row}>
            <Pressable style={styles.backButton} onPress={() => router.back()}>
              <Text style={styles.backButtonText}>← Back</Text>
            </Pressable>
            <Text style={styles.title}>Tank animation preview</Text>
          </View>

          <Text style={styles.label}>Fish</Text>
          <View style={styles.row}>
            {COUNT_OPTIONS.map((n) => (
              <Chip
                key={n}
                label={String(n)}
                active={aliveCount === n}
                onPress={() => setAliveCount(n)}
              />
            ))}
          </View>

          <Text style={styles.label}>Dead fish</Text>
          <View style={styles.row}>
            {DEAD_OPTIONS.map((n) => (
              <Chip
                key={n}
                label={String(n)}
                active={deadCount === n}
                onPress={() => setDeadCount(n)}
              />
            ))}
          </View>

          <Pressable style={styles.regenerateButton} onPress={() => setGeneration((g) => g + 1)}>
            <Text style={styles.regenerateButtonText}>Regenerate traits</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.chip, active && styles.chipActive]} onPress={onPress}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.waterBottom },
  overlay: {},
  panel: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(4, 18, 29, 0.75)",
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
    maxWidth: 280,
  },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.xs, flexWrap: "wrap" },
  title: { color: palette.text, fontSize: 15, fontWeight: "700" },
  label: { color: palette.textFaint, fontSize: 11, fontWeight: "600", marginTop: spacing.xs },
  backButton: { paddingVertical: spacing.xs, paddingRight: spacing.xs },
  backButtonText: { color: palette.accent, fontSize: 13, fontWeight: "600" },
  chip: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  chipActive: { backgroundColor: palette.accentDark, borderColor: palette.accent },
  chipText: { color: palette.textFaint, fontSize: 12, fontWeight: "600" },
  chipTextActive: { color: palette.text },
  regenerateButton: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginTop: spacing.sm,
  },
  regenerateButtonText: { color: palette.textFaint, fontSize: 11, fontWeight: "600" },
});
