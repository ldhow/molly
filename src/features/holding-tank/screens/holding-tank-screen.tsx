import { useRouter } from "expo-router";
import { useState } from "react";
import {
  Alert,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import type { SessionRow } from "@/db/schema";
import { Button } from "@/shared/components/button";
import { EmptyState } from "@/shared/components/empty-state";
import { ScreenContainer } from "@/shared/components/screen-container";
import { palette, radius, spacing } from "@/shared/constants/theme";
import { getSpeciesDef } from "@/shared/creature/catalog";
import { speciesOfRow } from "@/shared/creature/resolve";
import { TANK_CAPACITY } from "@/shared/lib/tank-membership";

import { useFishCollection } from "../api/use-fish-collection";
import { useSwapTankFishMutation } from "../api/use-swap-tank-fish-mutation";
import { FishTile } from "../components/fish-tile";

export function HoldingTankScreen() {
  const router = useRouter();
  const { inTank, holding, isLoading } = useFishCollection();
  const swap = useSwapTankFishMutation();
  const [pickingReplacementFor, setPickingReplacementFor] = useState<string | null>(null);
  const { width } = useWindowDimensions();
  const numColumns = width >= 700 ? 4 : 2;

  const tankFull = inTank.length >= TANK_CAPACITY;

  const onPressHolding = (row: SessionRow) => {
    if (pickingReplacementFor) return; // mid-pick — only in-tank tiles are actionable
    if (!tankFull) {
      swap.mutate({ addId: row.id });
      return;
    }
    setPickingReplacementFor(row.id);
  };

  const onPressInTank = (row: SessionRow) => {
    if (pickingReplacementFor) {
      swap.mutate({ addId: pickingReplacementFor, removeId: row.id });
      setPickingReplacementFor(null);
      return;
    }
    const noun = getSpeciesDef(speciesOfRow(row)).copy.noun;
    Alert.alert(
      "Send back to holding tank?",
      `This ${noun} will leave the tank and move to your Holding Tank.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Send back",
          style: "destructive",
          onPress: () => swap.mutate({ removeId: row.id }),
        },
      ],
    );
  };

  if (isLoading) return null;

  return (
    <ScreenContainer>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Button
            label="‹ Back"
            variant="ghost"
            onPress={() => router.back()}
            style={styles.backButton}
          />
          <Text style={styles.title}>Holding Tank</Text>
          <Text style={styles.subtitle}>
            {inTank.length}/{TANK_CAPACITY} in tank · {holding.length} in holding
          </Text>
        </View>

        {pickingReplacementFor ? (
          <View style={styles.pickBanner}>
            <Text style={styles.pickBannerText}>
              Tank is full — pick a fish below to send back to holding tank.
            </Text>
            <Button label="Cancel" variant="ghost" onPress={() => setPickingReplacementFor(null)} />
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>
          In Tank ({inTank.length}/{TANK_CAPACITY})
        </Text>
        {inTank.length === 0 ? (
          <EmptyState emoji="🫧" title="Your tank is empty" />
        ) : (
          <FlatList
            key={`in-tank-${numColumns}`}
            data={inTank}
            keyExtractor={(row) => row.id}
            numColumns={numColumns}
            columnWrapperStyle={numColumns > 1 ? styles.column : undefined}
            scrollEnabled={false}
            renderItem={({ item }) => <FishTile row={item} onPress={() => onPressInTank(item)} />}
          />
        )}

        <Text style={styles.sectionTitle}>Holding Tank ({holding.length})</Text>
        {holding.length === 0 ? (
          <EmptyState
            emoji="📦"
            title="Nothing in holding"
            caption="Fish beyond your tank's capacity land here."
          />
        ) : (
          <FlatList
            key={`holding-${numColumns}`}
            data={holding}
            keyExtractor={(row) => row.id}
            numColumns={numColumns}
            columnWrapperStyle={numColumns > 1 ? styles.column : undefined}
            scrollEnabled={false}
            renderItem={({ item }) => (
              <FishTile
                row={item}
                selected={item.id === pickingReplacementFor}
                onPress={() => onPressHolding(item)}
              />
            )}
          />
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.xl },
  header: { gap: spacing.xs, paddingBottom: spacing.md },
  backButton: {
    alignSelf: "flex-start",
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  title: { color: palette.text, fontSize: 28, fontWeight: "700", marginTop: spacing.sm },
  subtitle: { color: palette.textDim, fontSize: 14 },
  sectionTitle: {
    color: palette.textDim,
    fontSize: 13,
    fontWeight: "600",
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  pickBanner: {
    backgroundColor: palette.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  pickBannerText: { color: palette.text, fontSize: 13 },
  column: { gap: spacing.md, marginBottom: spacing.md },
});
