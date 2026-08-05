import { Pressable, StyleSheet, Text, View } from "react-native";

import { palette, radius, spacing } from "@/shared/constants/theme";

import { DURATION_PRESETS_MINUTES } from "../constants";

type Props = {
  minutes: number;
  onChange: (minutes: number) => void;
};

export function DurationPicker({ minutes, onChange }: Props) {
  const presets = __DEV__ ? [1, ...DURATION_PRESETS_MINUTES] : DURATION_PRESETS_MINUTES;

  return (
    <View style={styles.wrap}>
      {presets.map((preset) => {
        const selected = preset === minutes;
        return (
          <Pressable
            key={preset}
            onPress={() => onChange(preset)}
            style={[styles.chip, selected && styles.chipSelected]}
          >
            <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{preset}m</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
  },
  chipSelected: {
    backgroundColor: palette.accent,
    borderColor: palette.accent,
  },
  chipLabel: { color: palette.textDim, fontSize: 15, fontWeight: "600" },
  chipLabelSelected: { color: "#03222f" },
});
