import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import type { SessionRow } from "@/db/schema";
import { Button } from "@/shared/components/button";
import { CoinChip } from "@/shared/components/coin-chip";
import { EmptyState } from "@/shared/components/empty-state";
import { FishTile } from "@/shared/components/fish-tile";
import { ScreenContainer } from "@/shared/components/screen-container";
import { palette, spacing } from "@/shared/constants/theme";
import { getSpeciesDef } from "@/shared/creature/catalog";
import { resolveCreature } from "@/shared/creature/resolve";
import { getColorDef } from "@/shared/fish/catalog";

import { useSellFishMutation } from "../api/use-sell-fish-mutation";
import { useSellableFish, type SellableEntry } from "../api/use-sellable-fish";
import { SellFishCard } from "../components/sell-fish-card";

function nameOf(row: SessionRow): string {
  const resolved = resolveCreature(row);
  if (resolved.speciesId === "molly") return getColorDef(resolved.traits.color).name;
  const def = getSpeciesDef(resolved.speciesId);
  return def.variants.find((v) => v.id === resolved.variant)?.name ?? def.name;
}

export function SellFishScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const numColumns = width >= 700 ? 4 : 2;

  const { sellable, unsellable, isLoading } = useSellableFish();
  const { sell, hiddenIds } = useSellFishMutation();
  // Collapsed by default — see `ListFooterComponent` below for why this is a
  // performance decision, not just a tidier screen.
  const [showUnsellable, setShowUnsellable] = useState(false);

  // A just-sold fish leaves the list HERE, one cheap local re-render ahead of
  // the `["sessions"]` cache write that would eventually drop it anyway — see
  // `useSellFishMutation`'s three-phase doc for why waiting on that write is
  // what made a sale feel slow. Skips allocating a new array entirely in the
  // common case (nothing sold yet), so the normal render path is untouched.
  const visible = useMemo(
    () => (hiddenIds.size === 0 ? sellable : sellable.filter((e) => !hiddenIds.has(e.row.id))),
    [sellable, hiddenIds],
  );

  // Stable across renders (`sell` is a `useCallback` over React Query's own
  // stable `mutate`) so every `SellFishCard` in the list receives the SAME
  // `onSell` reference on every render. Combined with `useSellableFish`'s
  // cached `entry` objects, that's what lets `memo(SellFishCard)` skip
  // re-rendering (and re-drawing its Skia preview) for every fish except the
  // one actually being sold.
  const confirmSell = useCallback(
    ({ row, price }: SellableEntry) => {
      Alert.alert(
        "Sell this fish?",
        `Sell your ${nameOf(row)} for ${price} coins? This is permanent — it stays in your Fishdex, but leaves your tank for good.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Sell", style: "destructive", onPress: () => sell(row.id) },
        ],
      );
    },
    [sell],
  );

  if (isLoading) return null;

  return (
    <ScreenContainer>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.listContent}>
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <Button
              label="‹ Back"
              variant="ghost"
              onPress={() => router.back()}
              style={styles.backButton}
            />
            <CoinChip />
          </View>
          <Text style={styles.title}>Sell Fish</Text>
          <Text style={styles.subtitle}>
            Sell a completed fish for coins. Dead fish can&apos;t be sold.
          </Text>
        </View>

        {/*
          A hand-laid flex-wrap grid, NOT a `FlatList numColumns={2}`, and the
          difference is the whole reason selling used to take seconds.
          `FlatList` builds a multi-column row's React key by JOINING the
          keyExtractor results of the items in that row — literally
          `items.map(keyExtractor).join(":")` (react-native/Libraries/Lists/
          FlatList.js `_keyExtractor`), used as the cell's `key` in
          VirtualizedList. Selling one fish re-pairs every row after it, so
          every row key below the sale CHANGES, and React unmounts and
          remounts each of those cells. Each cell holds a `FishTile` whose
          preview is a Skia `<Canvas>` — on Android a non-flattenable native
          view that acquires and releases its own EGL window surface on
          mount/unmount. That native churn, serialized on the main thread, is
          the 1-2s; it is invisible to `memo`, since a memo comparator is
          never consulted for a component that is being created from scratch.

          Keying each tile by its own fish id makes a sale a pure layout
          shift: every surviving tile keeps its identity, its Canvas and its
          EGL surface. The footer below always used this shape already.
        */}
        {visible.length === 0 ? (
          <EmptyState
            emoji="🐟"
            title="Nothing to sell yet"
            caption="Complete a focus session first."
          />
        ) : (
          <View style={styles.grid}>
            {visible.map((entry) => (
              <View key={entry.row.id} style={[styles.cell, { width: `${100 / numColumns}%` }]}>
                <SellFishCard entry={entry} onSell={confirmSell} />
              </View>
            ))}
          </View>
        )}

        {unsellable.length > 0 ? (
          <View style={styles.unsellableSection}>
            <Pressable onPress={() => setShowUnsellable((v) => !v)} style={styles.unsellableToggle}>
              <Text style={styles.sectionTitle}>
                {showUnsellable ? "▾" : "▸"} Can&apos;t be sold ({unsellable.length})
              </Text>
            </Pressable>
            {/* Collapsed by default: these tiles aren't actionable here, and
                each one costs a native Skia view just by being mounted. */}
            {showUnsellable ? (
              <View style={styles.unsellableGrid}>
                {unsellable.map((row) => (
                  <View key={row.id} style={styles.unsellableTile}>
                    <FishTile row={row} />
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.xs, paddingBottom: spacing.md },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: spacing.sm,
  },
  backButton: { paddingHorizontal: spacing.sm },
  title: { color: palette.text, fontSize: 28, fontWeight: "700", marginTop: spacing.sm },
  subtitle: { color: palette.textDim, fontSize: 14 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  // The gutter lives as padding INSIDE each cell rather than as `gap` on the
  // grid, so a cell's percentage width stays exact arithmetic (`100/n`%) and
  // doesn't have to account for the gap eating into the row.
  cell: { padding: spacing.xs },
  listContent: { paddingBottom: spacing.xl },
  unsellableSection: { marginTop: spacing.md, gap: spacing.sm, opacity: 0.5 },
  unsellableToggle: { paddingVertical: spacing.xs },
  sectionTitle: { color: palette.textDim, fontSize: 13, fontWeight: "600" },
  unsellableGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  unsellableTile: { width: 140 },
});
