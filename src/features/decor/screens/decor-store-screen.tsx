import { useRouter } from "expo-router";
import { Pressable, FlatList, StyleSheet, Text, useWindowDimensions, View } from "react-native";

import { Button } from "@/shared/components/button";
import { CoinChip } from "@/shared/components/coin-chip";
import { ScreenContainer } from "@/shared/components/screen-container";
import { palette, radius, spacing } from "@/shared/constants/theme";
import { DECOR_CATALOG } from "@/shared/decor/catalog";
import { useCoinBalance } from "@/shared/hooks/use-coin-balance";

import { buildDecorRow, useBuyDecorMutation } from "../api/use-buy-decor-mutation";
import { useOwnedDecor } from "../api/use-owned-decor";
import { useResetDecorMutation } from "../api/use-reset-decor-mutation";
import { DecorCard } from "../components/decor-card";

export function DecorStoreScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const numColumns = width >= 700 ? 4 : 2;

  const { balance } = useCoinBalance();
  const { all: owned } = useOwnedDecor();
  const buy = useBuyDecorMutation();
  const resetDecor = useResetDecorMutation();

  const ownedCountOf = (id: string) => owned.filter((row) => row.itemId === id).length;

  const buyItem = (itemId: string) => {
    const row = buildDecorRow(itemId, owned);
    if (row) buy.mutate(row);
  };

  return (
    <ScreenContainer>
      <FlatList
        key={numColumns}
        data={DECOR_CATALOG}
        keyExtractor={(def) => def.id}
        numColumns={numColumns}
        columnWrapperStyle={styles.column}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
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
            <Text style={styles.title}>Decor Store</Text>
            <Text style={styles.subtitle}>
              Sell fish for coins, spend them decorating your tank.
            </Text>
            <View style={styles.linkRow}>
              <Button
                label="Sell a fish"
                variant="ghost"
                onPress={() => router.push("/sell-fish")}
              />
              <Button
                label="Arrange tank"
                variant="ghost"
                onPress={() => router.push("/decorate")}
              />
            </View>
            {__DEV__ ? (
              <Pressable
                style={styles.devButton}
                onPress={() => resetDecor.mutate()}
                disabled={resetDecor.isPending}
              >
                <Text style={styles.devButtonText}>DEV: reset decor</Text>
              </Pressable>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <DecorCard
            def={item}
            owned={ownedCountOf(item.id)}
            affordable={balance >= item.price}
            onBuy={() => buyItem(item.id)}
            buying={buy.isPending}
          />
        )}
        contentContainerStyle={styles.listContent}
      />
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
  linkRow: { flexDirection: "row", gap: spacing.xs, marginTop: spacing.xs },
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
});
