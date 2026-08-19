import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useMemo, useState } from "react";
import { CreaturePreview } from "@/shared/aquarium/render/creature-preview";
import { FishPreview } from "@/shared/aquarium/render/fish-preview";
import { Button } from "@/shared/components/button";
import { ScreenContainer } from "@/shared/components/screen-container";
import { palette, radius, spacing } from "@/shared/constants/theme";
import { getSpeciesDef, standardVariant } from "@/shared/creature/catalog";
import type { SpeciesId } from "@/shared/creature/types";
import { useSpeciesUnlocks } from "@/shared/creature/use-unlocks";
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
import type { CreatureSelection } from "../types";

const PREVIEW_W = 200;
const PREVIEW_H = 104;

export function FocusHomeScreen() {
  const [minutes, setMinutes] = useState(DEFAULT_DURATION_MINUTES);
  const [speciesId, setSpeciesId] = useState<SpeciesId>("molly");
  const [colorId, setColorId] = useState<ColorId>(DEFAULT_COLOR_ID);
  const { entries: colorEntries } = useUnlocks();
  const { entries: speciesEntries } = useSpeciesUnlocks();
  const { data: sessionRows } = useSessionsQuery();
  const now = useNow(60_000);
  const currentStreak = useMemo(
    () => computeCurrentStreak(sessionRows ?? [], now),
    [sessionRows, now],
  );
  const startSession = useStartSession();

  const isMolly = speciesId === "molly";
  const speciesDef = getSpeciesDef(speciesId);
  const speciesEntry = speciesEntries.find((e) => e.def.id === speciesId);
  const speciesUnlocked = speciesEntry?.unlocked ?? false;

  const selectedColor = getColorDef(colorId);
  const colorEntry = colorEntries.find((e) => e.def.id === colorId);
  const colorUnlocked = colorEntry?.unlocked ?? false;

  // For molly, the color itself is gated (today's behaviour, unchanged).
  // For every other species, only the SPECIES is gated — its variants are
  // never individually locked, same "rolled and collected" rule molly's own
  // body/tail/dorsal already follow (see `creature/catalog.ts`'s header).
  const selectedUnlocked = isMolly ? colorUnlocked : speciesUnlocked;

  const startPress = () => {
    const selection: CreatureSelection = isMolly ? { speciesId: "molly", colorId } : { speciesId };
    startSession(selection, minutes);
  };

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
          {isMolly ? (
            <View style={styles.previewCanvas}>
              <FishPreview
                traits={standardTraits(colorId)}
                stage="adult"
                width={PREVIEW_W}
                height={PREVIEW_H}
                locked={!selectedUnlocked}
              />
            </View>
          ) : selectedUnlocked ? (
            <CreaturePreview
              speciesId={speciesId}
              variant={standardVariant(speciesId)}
              width={PREVIEW_W}
              height={PREVIEW_H}
            />
          ) : (
            <View style={[styles.previewCanvas, styles.previewPlaceholder]}>
              <Text style={styles.previewPlaceholderText}>???</Text>
            </View>
          )}
          <View style={styles.previewNameRow}>
            <Text style={styles.previewName}>
              {isMolly
                ? selectedUnlocked
                  ? selectedColor.name
                  : "???"
                : selectedUnlocked
                  ? speciesDef.name
                  : "???"}
            </Text>
            <Text
              style={[
                styles.rarityBadge,
                {
                  color:
                    RARITY_COLORS[isMolly ? selectedColor.rarity.tier : speciesDef.rarity.tier],
                },
              ]}
            >
              {formatRarity(isMolly ? selectedColor.rarity : speciesDef.rarity)}
            </Text>
          </View>
          <Text style={styles.previewHint}>
            {selectedUnlocked
              ? isMolly
                ? selectedColor.description
                : speciesDef.description
              : unlockHint(isMolly ? selectedColor.unlock : speciesDef.unlock)}
          </Text>
          {selectedUnlocked ? (
            <Text style={styles.rollNote}>
              {isMolly
                ? "Body & fins are revealed when your molly grows up 🎲"
                : `Its coat is revealed when your ${speciesDef.copy.noun} grows up 🎲`}
            </Text>
          ) : null}
        </View>

        <Text style={styles.sectionTitle}>Species</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.variantRow}
        >
          {speciesEntries.map(({ def, unlocked }) => {
            const active = def.id === speciesId;
            return (
              <Pressable
                key={def.id}
                onPress={() => setSpeciesId(def.id)}
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

        {isMolly ? (
          <>
            <Text style={styles.sectionTitle}>Your molly</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.variantRow}
            >
              {colorEntries.map(({ def, unlocked }) => {
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
          </>
        ) : null}

        <Text style={styles.sectionTitle}>Focus for</Text>
        <DurationPicker minutes={minutes} onChange={setMinutes} />

        <Button
          label={`Start ${minutes} min focus`}
          onPress={startPress}
          disabled={!selectedUnlocked}
          style={styles.startButton}
        />
        {!selectedUnlocked ? (
          <Text style={styles.lockedNote}>
            This {speciesDef.copy.noun} is still locked —{" "}
            {unlockHint(isMolly ? selectedColor.unlock : speciesDef.unlock).toLowerCase()}.
          </Text>
        ) : (
          <Text style={styles.lockedNote}>
            Leave the app mid-session and your {speciesDef.copy.noun} won&apos;t survive.
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
  previewPlaceholder: { alignItems: "center", justifyContent: "center" },
  previewPlaceholderText: { color: palette.textDim, fontSize: 15, fontWeight: "700" },
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
