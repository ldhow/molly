import { StyleSheet, Text, View } from "react-native";

import { palette, radius, spacing } from "@/shared/constants/theme";

type Props = {
  label: string;
  value: string;
  accent?: boolean;
};

export function StatCard({ label, value, accent }: Props) {
  return (
    <View style={styles.card}>
      <Text style={[styles.value, accent && styles.accentValue]}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: 2,
  },
  value: { color: palette.text, fontSize: 24, fontWeight: "700" },
  accentValue: { color: palette.accent },
  label: { color: palette.textDim, fontSize: 13 },
});
