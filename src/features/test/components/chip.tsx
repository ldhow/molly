import { Pressable, StyleSheet, Text } from "react-native";

import { palette, radius, spacing } from "@/shared/constants/theme";

interface Props {
  label: string;
  active: boolean;
  onPress: () => void;
}

/** Same pill toggle the tank preview screen uses — kept local per the no-cross-feature-imports rule. */
export function Chip({ label, active, onPress }: Props) {
  return (
    <Pressable style={[styles.chip, active && styles.chipActive]} onPress={onPress}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  chipActive: { backgroundColor: palette.accentDark, borderColor: palette.accent },
  chipText: { color: palette.textFaint, fontSize: 12, fontWeight: "600" },
  chipTextActive: { color: palette.text },
});
