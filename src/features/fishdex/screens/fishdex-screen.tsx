import { useMemo } from "react";
import { FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";

import { CreaturePreview } from "@/shared/aquarium/render/creature-preview";
import { ScreenContainer } from "@/shared/components/screen-container";
import { palette, radius, spacing } from "@/shared/constants/theme";
import { standardVariant } from "@/shared/creature/catalog";
import { resolveCreature } from "@/shared/creature/resolve";
import type { SpeciesId } from "@/shared/creature/types";
import { useSpeciesUnlocks, useToggleSpeciesGrantMutation } from "@/shared/creature/use-unlocks";
import { BODY_DEFS, DORSAL_DEFS, TAIL_DEFS } from "@/shared/fish/catalog";
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
  const { entries: speciesEntries, grantedSpecies } = useSpeciesUnlocks();
  const toggleSpeciesGrant = useToggleSpeciesGrantMutation();
  const { width } = useWindowDimensions();
  const numColumns = width >= 700 ? 4 : 2;

  // Body/tail/dorsal rolls only ever apply to molly rows — a creature row
  // routed through `traitsOfRow` here would silently collect fake trait ids
  // (see `resolveCreature`'s header comment), so filter to molly first.
  const traitEntries = useMemo<TraitEntry[]>(() => {
    const collected = {
      body: new Set<string>(),
      tail: new Set<string>(),
      dorsal: new Set<string>(),
    };
    for (const row of rows ?? []) {
      if (row.outcome !== "completed") continue;
      const resolved = resolveCreature(row);
      if (resolved.speciesId !== "molly") continue;
      collected.body.add(resolved.traits.body);
      collected.tail.add(resolved.traits.tail);
      collected.dorsal.add(resolved.traits.dorsal);
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

  const creatureSpeciesEntries = speciesEntries.filter(
    (e): e is (typeof speciesEntries)[number] & { def: { id: Exclude<SpeciesId, "molly"> } } =>
      e.def.id !== "molly",
  );

  // Per-species variant "seen" tracking — the collection loop for species
  // whose variants roll freely once unlocked, instead of being individually
  // gated the way molly's colors are.
  const speciesVariantSeen = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const row of rows ?? []) {
      if (row.outcome !== "completed") continue;
      const resolved = resolveCreature(row);
      if (resolved.speciesId === "molly") continue;
      const set = map.get(resolved.speciesId) ?? new Set<string>();
      set.add(resolved.variant);
      map.set(resolved.speciesId, set);
    }
    return map;
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
              {unlockedIds.length} of {entries.length} colors ·{" "}
              {creatureSpeciesEntries.filter((e) => e.unlocked).length} of{" "}
              {creatureSpeciesEntries.length} creatures discovered
            </Text>
            {__DEV__ ? (
              <View style={styles.devRow}>
                <Pressable style={styles.devButton} onPress={() => toggleGrant.mutate("sanke")}>
                  <Text style={styles.devButtonText}>
                    {grantedColors.includes("sanke")
                      ? "DEV: revoke Sanke grant"
                      : "DEV: grant Sanke"}
                  </Text>
                </Pressable>
                <Pressable
                  style={styles.devButton}
                  onPress={() => toggleSpeciesGrant.mutate("otter")}
                >
                  <Text style={styles.devButtonText}>
                    {grantedSpecies.includes("otter")
                      ? "DEV: revoke Otter grant"
                      : "DEV: grant Otter"}
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        }
        renderItem={({ item }) => <FishdexCard def={item.def} unlocked={item.unlocked} />}
        ListFooterComponent={
          <>
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
            <View style={styles.traitSection}>
              <Text style={styles.sectionTitle}>Creatures</Text>
              <Text style={styles.sectionHint}>
                Grow a companion of each species — its coat is revealed and collected here.
              </Text>
              {creatureSpeciesEntries.map(({ def, unlocked }) => {
                const seen = speciesVariantSeen.get(def.id) ?? new Set<string>();
                const rarityColor = RARITY_COLORS[def.rarity.tier];
                return (
                  <View key={def.id} style={styles.speciesBlock}>
                    <View style={styles.speciesHeaderRow}>
                      {unlocked ? (
                        <View style={styles.speciesThumb}>
                          <CreaturePreview
                            speciesId={def.id}
                            variant={standardVariant(def.id)}
                            width={56}
                            height={40}
                          />
                        </View>
                      ) : null}
                      <View style={[styles.traitRow, styles.flexGrow]}>
                        <Text style={styles.traitName}>{unlocked ? def.name : "🔒 ???"}</Text>
                        <Text style={[styles.traitRarity, { color: rarityColor }]}>
                          {formatRarity(def.rarity)}
                        </Text>
                      </View>
                    </View>
                    {unlocked
                      ? def.variants.map((variant) => (
                          <View key={variant.id} style={styles.traitRow}>
                            <Text style={styles.traitAxis}>{def.name}</Text>
                            <Text style={styles.traitName}>{variant.name}</Text>
                            <Text
                              style={seen.has(variant.id) ? styles.collected : styles.notCollected}
                            >
                              {seen.has(variant.id) ? "✓" : "—"}
                            </Text>
                          </View>
                        ))
                      : null}
                  </View>
                );
              })}
            </View>
          </>
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
  devRow: { flexDirection: "row", gap: spacing.xs },
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
  speciesBlock: { gap: spacing.xs },
  speciesHeaderRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  flexGrow: { flex: 1 },
  speciesThumb: {
    width: 56,
    height: 40,
    borderRadius: radius.sm,
    overflow: "hidden",
    backgroundColor: palette.surfaceAlt,
  },
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
