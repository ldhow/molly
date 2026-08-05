import { Pressable, StyleSheet, Text, type ViewStyle } from "react-native";

import { palette, radius, spacing } from "@/shared/constants/theme";

type Variant = "primary" | "ghost" | "danger";

type Props = {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  style?: ViewStyle;
};

export function Button({ label, onPress, variant = "primary", disabled, style }: Props) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.base,
        variantStyles[variant],
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      <Text style={[styles.label, labelStyles[variant]]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.md - 2,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
  },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.4 },
  label: { fontSize: 16, fontWeight: "600" },
});

const variantStyles: Record<Variant, ViewStyle> = {
  primary: { backgroundColor: palette.accent },
  ghost: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: palette.border,
  },
  danger: { backgroundColor: palette.danger },
};

const labelStyles = StyleSheet.create({
  primary: { color: "#03222f" },
  ghost: { color: palette.textDim },
  danger: { color: "#2d0b0b" },
});
