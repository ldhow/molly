import { StyleSheet, Text, View } from "react-native";

import { palette, radius, spacing } from "@/shared/constants/theme";
import { useCoinBalance } from "@/shared/hooks/use-coin-balance";

/** Ambient balance readout — the "focus earns money" reminder, shown on the
 *  Tank header and next to the Focus home streak chip. */
export function CoinChip() {
  const { balance, isLoading } = useCoinBalance();
  if (isLoading) return null;

  return (
    <View style={styles.chip}>
      <Text style={styles.text}>🪙 {balance}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  text: { color: palette.warning, fontWeight: "700" },
});
