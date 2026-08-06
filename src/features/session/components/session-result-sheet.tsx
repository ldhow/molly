import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TankCanvas } from "@/shared/components/tank/tank-canvas";
import { Button } from "@/shared/components/button";
import { palette, radius, spacing } from "@/shared/constants/theme";
import { BODY_DEFS, DORSAL_DEFS, getColorDef, TAIL_DEFS } from "@/shared/fish/catalog";
import { formatRarity, RARITY_COLORS } from "@/shared/fish/rarity";
import type { Rarity } from "@/shared/fish/types";
import { seedFromString } from "@/shared/lib/seed";
import { formatMinutes } from "@/shared/lib/dates";

import { useSessionStore } from "../store/session-store";
import type { SessionResult } from "../types";

const COPY = {
  completed: { emoji: "🎉", title: "Your molly made it!" },
  failed: { emoji: "🪦", title: "Your molly didn't survive..." },
  abandoned: { emoji: "🏳️", title: "Session abandoned" },
} as const;

interface RevealItem {
  label: string;
  rarity: Rarity;
}

/** Non-standard rolled traits worth announcing on the reveal. */
function revealItems(result: SessionResult): RevealItem[] {
  const items: RevealItem[] = [];
  const body = BODY_DEFS.find((d) => d.id === result.traits.body);
  const tail = TAIL_DEFS.find((d) => d.id === result.traits.tail);
  const dorsal = DORSAL_DEFS.find((d) => d.id === result.traits.dorsal);
  if (body && body.id !== "standard")
    items.push({ label: `${body.name} body`, rarity: body.rarity });
  if (tail && tail.id !== "round") items.push({ label: tail.name, rarity: tail.rarity });
  if (dorsal && dorsal.id !== "standard") items.push({ label: dorsal.name, rarity: dorsal.rarity });
  return items;
}

export function SessionResultSheet({ result }: { result: SessionResult }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const acknowledgeResult = useSessionStore((s) => s.acknowledgeResult);
  const colorDef = getColorDef(result.colorId);
  const completed = result.outcome === "completed";
  const copy = COPY[result.outcome];
  const reveals = completed ? revealItems(result) : [];

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
            traits: result.traits,
            stage: "adult",
            status: completed ? "alive" : "dead",
            scale: 1,
            seed: seedFromString(result.colorId + result.endedAt),
          },
        ]}
      />
      <View
        style={[
          styles.sheet,
          {
            paddingLeft: insets.left + spacing.lg,
            paddingRight: insets.right + spacing.lg,
            maxHeight: "85%",
          },
        ]}
      >
        <ScrollView
          contentContainerStyle={[
            styles.sheetContent,
            { paddingBottom: insets.bottom + spacing.lg },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.emoji}>{copy.emoji}</Text>
          <Text style={styles.title}>{copy.title}</Text>
          <Text style={styles.body}>
            {completed
              ? `${formatMinutes(result.plannedMinutes)} of focus raised a healthy ${colorDef.name} molly. It's swimming in your tank now.`
              : result.outcome === "failed"
                ? `You left mid-session and the ${colorDef.name} molly couldn't hold on. It rests in your tank as a reminder.`
                : `You gave up this time. The ${colorDef.name} molly rests in your tank as a reminder.`}
          </Text>

          {reveals.length > 0 ? (
            <View style={styles.reveals}>
              {reveals.map((item) => {
                const color = RARITY_COLORS[item.rarity.tier];
                return (
                  <View key={item.label} style={[styles.revealChip, { borderColor: color }]}>
                    <Text style={[styles.revealText, { color }]}>
                      ✨ {formatRarity(item.rarity)} — {item.label}!
                    </Text>
                  </View>
                );
              })}
            </View>
          ) : completed ? (
            <Text style={styles.plainRoll}>A classic round-tailed molly this time.</Text>
          ) : null}

          <View style={styles.buttons}>
            <Button
              label={completed ? "See your tank" : "Back home"}
              onPress={() => leave(completed ? "/(tabs)/tank" : "/(tabs)")}
            />
            {!completed ? (
              <Button label="Try again" variant="ghost" onPress={() => leave("/(tabs)")} />
            ) : null}
          </View>
        </ScrollView>
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
  },
  sheetContent: {
    paddingTop: spacing.lg,
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
  reveals: { gap: spacing.xs, alignItems: "center" },
  revealChip: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  revealText: { fontSize: 13, fontWeight: "700" },
  plainRoll: { color: palette.textFaint, fontSize: 12 },
  buttons: { alignSelf: "stretch", gap: spacing.sm, marginTop: spacing.sm },
});
