import { FlatList, StyleSheet, Text, View } from "react-native";

import { palette, spacing } from "@/shared/constants/theme";
import { ScreenContainer } from "@/shared/components/screen-container";

import { FishdexCard } from "../components/fishdex-card";
import { useUnlocks } from "@/shared/fish/use-unlocks";

export function FishdexScreen() {
  const { entries, unlockedIds } = useUnlocks();

  return (
    <ScreenContainer>
      <FlatList
        data={entries}
        keyExtractor={(entry) => entry.variant.id}
        numColumns={2}
        columnWrapperStyle={styles.column}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.title}>Fishdex</Text>
            <Text style={styles.subtitle}>
              {unlockedIds.length} of {entries.length} mollies discovered
            </Text>
          </View>
        }
        renderItem={({ item }) => <FishdexCard variant={item.variant} unlocked={item.unlocked} />}
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
  column: { gap: spacing.md, marginBottom: spacing.md },
  listContent: { paddingBottom: spacing.xl },
});
