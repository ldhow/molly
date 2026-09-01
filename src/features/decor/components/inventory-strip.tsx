import { Image } from "expo-image";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { DecorItemRow } from "@/db/schema";
import { SPRITE_SOURCES } from "@/shared/aquarium";
import { palette, radius, spacing } from "@/shared/constants/theme";
import { getDecorDef } from "@/shared/decor/catalog";

interface Props {
  items: readonly DecorItemRow[];
  selectedId: string | null;
  onSelect: (row: DecorItemRow) => void;
}

/**
 * Every owned decor item — placed or still in the bag — tap to select it for
 * editing (an unplaced item is placed at a default spot on first tap; see
 * `decorate-screen.tsx`). A wrapping grid, not a horizontal scroll strip —
 * this is meant to sit inside a roomy popup (see `decorate-screen.tsx`'s
 * inventory sheet), where a single cramped row was exactly what made picking
 * an item "bất tiện" (inconvenient); the caller supplies the scroll.
 */
export function InventoryStrip({ items, selectedId, onSelect }: Props) {
  return (
    <View style={styles.grid}>
      {items.map((row) => {
        const def = getDecorDef(row.itemId);
        if (!def) return null;
        const selected = row.id === selectedId;
        return (
          <Pressable
            key={row.id}
            onPress={() => onSelect(row)}
            style={[styles.tile, selected && styles.tileSelected]}
          >
            <Image
              source={SPRITE_SOURCES[def.id]}
              style={styles.thumb}
              contentFit="contain"
              accessibilityLabel={def.name}
            />
            <Text style={styles.label} numberOfLines={1}>
              {def.name}
            </Text>
            {row.layer === null ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>in bag</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const THUMB_SIZE = 56;

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  tile: {
    width: 84,
    alignItems: "center",
    gap: 2,
    padding: spacing.xs,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: "transparent",
  },
  tileSelected: { borderColor: palette.accent, backgroundColor: palette.surfaceAlt },
  thumb: { width: THUMB_SIZE, height: THUMB_SIZE },
  label: { color: palette.textDim, fontSize: 10, fontWeight: "600" },
  badge: {
    backgroundColor: palette.accentDark,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xs,
  },
  badgeText: { color: palette.text, fontSize: 8, fontWeight: "700" },
});
