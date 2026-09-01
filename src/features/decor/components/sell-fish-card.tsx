import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { FishTile } from "@/shared/components/fish-tile";
import { palette, spacing } from "@/shared/constants/theme";

import type { SellableEntry } from "../api/use-sellable-fish";

interface Props {
  entry: SellableEntry;
  /** Takes the whole entry (row + price) rather than being pre-bound to one
   *  fish — same reasoning as `FishTile.onPress`: one stable `useCallback`
   *  serves the whole list instead of a closure per row per render. */
  onSell: (entry: SellableEntry) => void;
}

/** A sellable fish tile with its coin price — tap to sell (the screen shows
 *  a confirm dialog). `memo`'d, and only actually skips re-rendering when
 *  BOTH `entry` (cached per-row by `useSellableFish`) and `onSell` (the
 *  screen's `useCallback`) are stable — see `FishTile`'s doc for why that's
 *  what keeps its Skia preview from redrawing on every unrelated sale. */
export const SellFishCard = memo(function SellFishCard({ entry, onSell }: Props) {
  return (
    <View style={styles.wrap}>
      <FishTile row={entry.row} onPress={() => onSell(entry)} />
      <Text style={styles.price}>🪙 {entry.price}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { flex: 1, gap: spacing.xs, alignItems: "center" },
  price: { color: palette.warning, fontSize: 13, fontWeight: "700" },
});
