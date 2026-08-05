import type { PropsWithChildren } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { palette, spacing } from "@/shared/constants/theme";

type Props = PropsWithChildren<{
  /** Remove horizontal padding (e.g. full-bleed tank canvas). */
  edgeToEdge?: boolean;
  style?: ViewStyle;
}>;

export function ScreenContainer({ children, edgeToEdge, style }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: insets.top }, !edgeToEdge && styles.padded, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: palette.bg,
  },
  padded: {
    paddingHorizontal: spacing.md,
  },
});
