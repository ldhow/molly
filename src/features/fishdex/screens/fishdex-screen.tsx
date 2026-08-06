import { useMemo } from "react";
import { FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";

import { ScreenContainer } from "@/shared/components/screen-container";
import { palette, radius, spacing } from "@/shared/constants/theme";
import { BODY_DEFS, DORSAL_DEFS, TAIL_DEFS, traitsOfRow } from "@/shared/fish/catalog";
import { formatRarity, RARITY_COLORS } from "@/shared/fish/rarity";
import type { Rarity } from "@/shared/fish/types";
import { useToggleColorGrantMutation, useUnlocks } from "@/shared/fish/use-unlocks";
import { useSessionsQuery } from "@/shared/hooks/use-sessions-query";

import { FishdexCard } from "../components/fishdex-card";

interface TraitEntry {
  key: string;
  axis: string;
  name: string;
  rarity: Rarity;
  weight: number;
  collected: boolean;
}

export function FishdexScreen() {
  const { entries, unlockedIds, grantedColors } = useUnlocks();
  const { data: rows } = useSessionsQuery();
  const toggleGrant = useToggleColorGrantMutation();
  const { width } = useWindowDimensions();
  const numColumns = width >= 700 ? 4 : 2;

  const traitEntries = useMemo<TraitEntry[]>(() => {
    const collected = {
      body: new Set<string>(),
      tail: new Set<string>(),
      dorsal: new Set<string>(),
    };
    for (const row of rows ?? []) {
      if (row.outcome !== "completed") continue;
      const traits = traitsOfRow(row);
      collected.body.add(traits.body);
      collected.tail.add(traits.tail);
      collected.dorsal.add(traits.dorsal);
    }
    return [
      ...BODY_DEFS.map((d) => ({ axis: "Body", set: collected.body, def: d })),
      ...TAIL_DEFS.map((d) => ({ axis: "Tail", set: collected.tail, def: d })),
      ...DORSAL_DEFS.map((d) => ({ axis: "Dorsal fin", set: collected.dorsal, def: d })),
    ].map(({ axis, set, def }) => ({
      key: `${axis}-${def.id}`,
      axis,
      name: def.name,
      rarity: def.rarity,
      weight: def.weight,
      collected: set.has(def.id),
    }));
  }, [rows]);

  return (
    <ScreenContainer>
      <FlatList
        key={numColumns}
        data={entries}
        keyExtractor={(entry) => entry.def.id}
        numColumns={numColumns}
        columnWrapperStyle={styles.column}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.title}>Fishdex</Text>
            <Text style={styles.subtitle}>
              {unlockedIds.length} of {entries.length} colors discovered
            </Text>
            {__DEV__ ? (
              <Pressable style={styles.devButton} onPress={() => toggleGrant.mutate("sanke")}>
                <Text style={styles.devButtonText}>
                  {grantedColors.includes("sanke") ? "DEV: revoke Sanke grant" : "DEV: grant Sanke"}
                </Text>
              </Pressable>
            ) : null}
          </View>
        }
        renderItem={({ item }) => <FishdexCard def={item.def} unlocked={item.unlocked} />}
        ListFooterComponent={
          <View style={styles.traitSection}>
            <Text style={styles.sectionTitle}>Rolled traits</Text>
            <Text style={styles.sectionHint}>
              Every completed session rolls body & fins — rare shapes are collected here.
            </Text>
            {traitEntries.map((entry) => {
              const color = RARITY_COLORS[entry.rarity.tier];
              return (
                <View key={entry.key} style={styles.traitRow}>
                  <Text style={styles.traitAxis}>{entry.axis}</Text>
                  <Text style={styles.traitName}>{entry.name}</Text>
                  <Text style={[styles.traitRarity, { color }]}>
                    {formatRarity(entry.rarity)} · {entry.weight}%
                  </Text>
                  <Text style={entry.collected ? styles.collected : styles.notCollected}>
                    {entry.collected ? "✓" : "—"}
                  </Text>
                </View>
              );
            })}
          </View>
        }
        contentContainerStyle={styles.listContent}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.xs, paddingBottom: spacing.md },
  title: {
    color: palette.text,
    fontSize: 28,
    fontWeight: "700",
    marginTop: spacing.sm,
  },
  subtitle: { color: palette.textDim, fontSize: 14 },
  devButton: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginTop: spacing.xs,
  },
  devButtonText: { color: palette.textFaint, fontSize: 11, fontWeight: "600" },
  column: { gap: spacing.md, marginBottom: spacing.md },
  listContent: { paddingBottom: spacing.xl },
  traitSection: {
    marginTop: spacing.md,
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  sectionTitle: { color: palette.text, fontSize: 16, fontWeight: "700" },
  sectionHint: { color: palette.textFaint, fontSize: 11 },
  traitRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  traitAxis: { color: palette.textFaint, fontSize: 11, width: 64 },
  traitName: { color: palette.text, fontSize: 13, fontWeight: "600", flex: 1 },
  traitRarity: { fontSize: 11, fontWeight: "700" },
  collected: {
    color: palette.success,
    fontSize: 14,
    fontWeight: "800",
    width: 18,
    textAlign: "center",
  },
  notCollected: { color: palette.textFaint, fontSize: 14, width: 18, textAlign: "center" },
});
