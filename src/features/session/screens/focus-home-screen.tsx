import { Canvas, Group } from "@shopify/react-native-skia";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useMemo, useState } from "react";
import { FishBody } from "@/shared/components/tank/fish-sprite";
import { Button } from "@/shared/components/button";
import { ScreenContainer } from "@/shared/components/screen-container";
import { palette, radius, spacing } from "@/shared/constants/theme";
import { DEFAULT_COLOR_ID, getColorDef, standardTraits } from "@/shared/fish/catalog";
import { formatRarity, RARITY_COLORS } from "@/shared/fish/rarity";
import type { ColorId } from "@/shared/fish/types";
import { unlockHint } from "@/shared/fish/unlocks";
import { useUnlocks } from "@/shared/fish/use-unlocks";
import { useNow } from "@/shared/hooks/use-now";
import { useSessionsQuery } from "@/shared/hooks/use-sessions-query";
import { computeCurrentStreak } from "@/shared/lib/sessions";

import { DurationPicker } from "../components/duration-picker";
import { DEFAULT_DURATION_MINUTES } from "../constants";
import { useStartSession } from "../hooks/use-start-session";

const PREVIEW_W = 200;
const PREVIEW_H = 104;

export function FocusHomeScreen() {
  const [minutes, setMinutes] = useState(DEFAULT_DURATION_MINUTES);
  const [colorId, setColorId] = useState<ColorId>(DEFAULT_COLOR_ID);
  const { entries } = useUnlocks();
  const { data: sessionRows } = useSessionsQuery();
  const now = useNow(60_000);
  const currentStreak = useMemo(
    () => computeCurrentStreak(sessionRows ?? [], now),
    [sessionRows, now],
  );
  const startSession = useStartSession();

  const selected = getColorDef(colorId);
  const selectedEntry = entries.find((e) => e.def.id === colorId);
  const selectedUnlocked = selectedEntry?.unlocked ?? false;

  return (
    <ScreenContainer>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.title}>Molly</Text>
            <Text style={styles.subtitle}>Focus. Let your fish grow.</Text>
          </View>
          {currentStreak > 0 ? (
            <View style={styles.streakChip}>
              <Text style={styles.streakText}>🔥 {currentStreak}d</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.previewCard}>
          <Canvas style={styles.previewCanvas}>
            <Group
              transform={[
                { translateX: PREVIEW_W / 2 },
                { translateY: PREVIEW_H / 2 },
                { scale: 0.82 },
              ]}
            >
              <FishBody
                traits={standardTraits(colorId)}
                stage="adult"
                clock={null}
                phase={0}
                silhouette={!selectedUnlocked}
              />
            </Group>
          </Canvas>
          <View style={styles.previewNameRow}>
            <Text style={styles.previewName}>{selectedUnlocked ? selected.name : "???"}</Text>
            <Text style={[styles.rarityBadge, { color: RARITY_COLORS[selected.rarity.tier] }]}>
              {formatRarity(selected.rarity)}
            </Text>
          </View>
          <Text style={styles.previewHint}>
            {selectedUnlocked ? selected.description : unlockHint(selected.unlock)}
          </Text>
          {selectedUnlocked ? (
            <Text style={styles.rollNote}>
              Body & fins are revealed when your molly grows up 🎲
            </Text>
          ) : null}
        </View>

        <Text style={styles.sectionTitle}>Your molly</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.variantRow}
        >
          {entries.map(({ def, unlocked }) => {
            const active = def.id === colorId;
            return (
              <Pressable
                key={def.id}
                onPress={() => setColorId(def.id)}
                style={[styles.variantChip, active && styles.variantChipActive]}
              >
                <View
                  style={[
                    styles.variantDot,
                    { backgroundColor: unlocked ? def.accentColor : palette.border },
                  ]}
                />
                <Text style={[styles.variantLabel, active && styles.variantLabelActive]}>
                  {unlocked ? def.name : "🔒"}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <Text style={styles.sectionTitle}>Focus for</Text>
        <DurationPicker minutes={minutes} onChange={setMinutes} />

        <Button
          label={`Start ${minutes} min focus`}
          onPress={() => startSession(colorId, minutes)}
          disabled={!selectedUnlocked}
          style={styles.startButton}
        />
        {!selectedUnlocked ? (
          <Text style={styles.lockedNote}>
            This molly is still locked — {unlockHint(selected.unlock).toLowerCase()}.
          </Text>
        ) : (
          <Text style={styles.lockedNote}>
            Leave the app mid-session and your molly won&apos;t survive.
          </Text>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingBottom: spacing.xl },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: spacing.sm,
  },
  title: { color: palette.text, fontSize: 32, fontWeight: "800" },
  subtitle: { color: palette.textDim, fontSize: 14, marginTop: 2 },
  streakChip: {
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  streakText: { color: palette.warning, fontWeight: "700" },
  previewCard: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: "center",
    padding: spacing.md,
    gap: spacing.xs,
  },
  previewCanvas: { width: PREVIEW_W, height: PREVIEW_H },
  previewNameRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  previewName: { color: palette.text, fontSize: 17, fontWeight: "700" },
  rarityBadge: { fontSize: 11, fontWeight: "800" },
  previewHint: { color: palette.textDim, fontSize: 13, textAlign: "center" },
  rollNote: { color: palette.textFaint, fontSize: 11, textAlign: "center" },
  sectionTitle: {
    color: palette.textDim,
    fontSize: 13,
    fontWeight: "600",
    marginTop: spacing.sm,
  },
  variantRow: { gap: spacing.sm, paddingRight: spacing.md },
  variantChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  variantChipActive: { borderColor: palette.accent },
  variantDot: { width: 10, height: 10, borderRadius: 5 },
  variantLabel: { color: palette.textDim, fontSize: 14, fontWeight: "600" },
  variantLabelActive: { color: palette.text },
  startButton: { marginTop: spacing.sm },
  lockedNote: {
    color: palette.textFaint,
    fontSize: 12,
    textAlign: "center",
  },
});
