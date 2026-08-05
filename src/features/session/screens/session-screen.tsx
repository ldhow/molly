import { useKeepAwake } from "expo-keep-awake";
import { Redirect } from "expo-router";
import { useEffect } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { standardTraits } from "@/shared/fish/catalog";
import type { LifeStage } from "@/shared/fish/types";
import { TankCanvas } from "@/shared/components/tank/tank-canvas";
import { seedFromString } from "@/shared/lib/seed";
import { Button } from "@/shared/components/button";
import { palette, radius, spacing } from "@/shared/constants/theme";
import { useNow } from "@/shared/hooks/use-now";
import { formatClock } from "@/shared/lib/dates";

import { SessionResultSheet } from "../components/session-result-sheet";
import { useSettleSession } from "../hooks/use-settle-session";
import { useSessionStore } from "../store/session-store";
import type { ActiveSession } from "../types";
import { progressOf, secondsLeftOf } from "../utils/machine";

/** Lock tag, so releasing ours cannot release anyone else's keep-awake. */
const KEEP_AWAKE_TAG = "molly-focus-screen";

export function SessionScreen() {
  // Hold the display on for as long as this screen is mounted. The tank IS the
  // timer — a fish growing in real time — so an auto-lock would hide the one
  // thing the user is here to watch. Released automatically on unmount.
  useKeepAwake(KEEP_AWAKE_TAG, { suppressDeactivateWarnings: true });

  const active = useSessionStore((s) => s.active);
  const result = useSessionStore((s) => s.result);

  if (active) return <ActiveSessionView session={active} />;
  if (result) return <SessionResultSheet result={result} />;
  return <Redirect href="/(tabs)" />;
}

function stageForProgress(progress: number): LifeStage {
  if (progress < 0.1) return "egg";
  if (progress < 0.4) return "fry";
  if (progress < 0.75) return "juvenile";
  return "adult";
}

const STAGE_LABEL: Record<LifeStage, string> = {
  egg: "An egg rests in the current…",
  fry: "A tiny fry hatched!",
  juvenile: "Growing into a young molly",
  adult: "Almost fully grown — keep going!",
};

function ActiveSessionView({ session }: { session: ActiveSession }) {
  const insets = useSafeAreaInsets();
  const now = useNow(1000);
  const settle = useSettleSession();
  const graceRecovered = useSessionStore((s) => s.graceRecovered);
  const setGraceRecovered = useSessionStore((s) => s.setGraceRecovered);

  useEffect(() => {
    if (!graceRecovered) return;
    const id = setTimeout(() => setGraceRecovered(false), 4000);
    return () => clearTimeout(id);
  }, [graceRecovered, setGraceRecovered]);

  const progress = progressOf(session, now);
  const stage = stageForProgress(progress);
  const traits = standardTraits(session.colorId);

  const confirmGiveUp = () => {
    Alert.alert("Give up?", "Your molly won't survive if you end the session early.", [
      { text: "Keep focusing", style: "cancel" },
      {
        text: "Give up",
        style: "destructive",
        onPress: () => settle("abandoned", Date.now()),
      },
    ]);
  };

  return (
    <View style={styles.root}>
      <TankCanvas
        mode="center"
        style={StyleSheet.absoluteFill as never}
        fish={[
          {
            key: session.id,
            traits,
            stage,
            status: "alive",
            scale: 0.45 + 0.55 * progress,
            seed: seedFromString(session.id),
          },
        ]}
      />

      <View style={[styles.top, { paddingTop: insets.top + spacing.md }]}>
        {graceRecovered ? (
          <View style={styles.graceBanner}>
            <Text style={styles.graceText}>Phew — your molly barely survived. Stay here!</Text>
          </View>
        ) : null}
        <Text style={styles.clock}>{formatClock(secondsLeftOf(session, now))}</Text>
        <Text style={styles.stageLabel}>{STAGE_LABEL[stage]}</Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { flex: progress }]} />
          <View style={{ flex: 1 - progress }} />
        </View>
      </View>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + spacing.lg }]}>
        <Button label="Give up" variant="ghost" onPress={confirmGiveUp} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.waterBottom },
  top: {
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  graceBanner: {
    backgroundColor: palette.warning,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  graceText: { color: "#3c2a00", fontWeight: "600", fontSize: 13 },
  clock: {
    color: palette.text,
    fontSize: 56,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
    textShadowColor: "rgba(0,0,0,0.4)",
    textShadowRadius: 12,
  },
  stageLabel: { color: palette.textDim, fontSize: 14 },
  progressTrack: {
    alignSelf: "stretch",
    flexDirection: "row",
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.15)",
    overflow: "hidden",
    marginTop: spacing.xs,
  },
  progressFill: { backgroundColor: palette.accent },
  bottom: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
  },
});
