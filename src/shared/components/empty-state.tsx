import { StyleSheet, Text, View } from "react-native";

import { palette, spacing } from "@/shared/constants/theme";

type Props = {
  emoji: string;
  title: string;
  caption?: string;
};

export function EmptyState({ emoji, title, caption }: Props) {
  return (
    <View style={styles.root}>
      <Text style={styles.emoji}>{emoji}</Text>
      <Text style={styles.title}>{title}</Text>
      {caption ? <Text style={styles.caption}>{caption}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    padding: spacing.xl,
  },
  emoji: { fontSize: 44 },
  title: {
    color: palette.text,
    fontSize: 18,
    fontWeight: "600",
    textAlign: "center",
  },
  caption: {
    color: palette.textDim,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
});
