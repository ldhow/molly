import { useRouter } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getVariant } from "@/shared/fish/variants";
import { TankCanvas } from "@/shared/components/tank/tank-canvas";
import { seedFromString } from "@/shared/lib/seed";
import { Button } from "@/shared/components/button";
import { palette, radius, spacing } from "@/shared/constants/theme";
import { formatMinutes } from "@/shared/lib/dates";

import { useSessionStore } from "../store/session-store";
import type { SessionResult } from "../types";

const COPY = {
  completed: {
    emoji: "🎉",
    title: "Your molly made it!",
    body: (name: string, minutes: string) =>
      `${minutes} of focus raised a healthy ${name}. It's swimming in your tank now.`,
  },
  failed: {
    emoji: "🪦",
    title: "Your molly didn't survive...",
    body: (name: string) =>
      `You left mid-session and the ${name} couldn't hold on. It rests in your tank as a reminder.`,
  },
  abandoned: {
    emoji: "🏳️",
    title: "Session abandoned",
    body: (name: string) => `You gave up this time. The ${name} rests in your tank as a reminder.`,
  },
} as const;

export function SessionResultSheet({ result }: { result: SessionResult }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const acknowledgeResult = useSessionStore((s) => s.acknowledgeResult);
  const variant = getVariant(result.variantId);
  const completed = result.outcome === "completed";
  const copy = COPY[result.outcome];

  const leave = (href: "/(tabs)/tank" | "/(tabs)") => {
    acknowledgeResult();
    router.replace(href);
  };

  return (
    <View style={styles.root}>
      <TankCanvas
        mode="center"
        style={StyleSheet.absoluteFill as never}
        fish={[
          {
            key: "result",
            variant,
            stage: "adult",
            status: completed ? "alive" : "dead",
            scale: 1,
            seed: seedFromString(result.variantId + result.endedAt),
          },
        ]}
      />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
        <Text style={styles.emoji}>{copy.emoji}</Text>
        <Text style={styles.title}>{copy.title}</Text>
        <Text style={styles.body}>
          {result.outcome === "completed"
            ? COPY.completed.body(variant.name, formatMinutes(result.plannedMinutes))
            : COPY[result.outcome].body(variant.name)}
        </Text>
        <View style={styles.buttons}>
          <Button
            label={completed ? "See your tank" : "Back home"}
            onPress={() => leave(completed ? "/(tabs)/tank" : "/(tabs)")}
          />
          {!completed ? (
            <Button label="Try again" variant="ghost" onPress={() => leave("/(tabs)")} />
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.waterBottom },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(4, 18, 29, 0.92)",
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    alignItems: "center",
  },
  emoji: { fontSize: 40 },
  title: { color: palette.text, fontSize: 22, fontWeight: "700" },
  body: {
    color: palette.textDim,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  buttons: { alignSelf: "stretch", gap: spacing.sm, marginTop: spacing.sm },
});
