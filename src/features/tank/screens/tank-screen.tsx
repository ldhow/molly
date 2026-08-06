import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/shared/components/empty-state";
import { palette, radius, spacing } from "@/shared/constants/theme";

import { TankCanvas } from "@/shared/components/tank/tank-canvas";
import { useAddDevFishMutation } from "../api/use-add-dev-fish-mutation";
import { useOwnedFish } from "../api/use-owned-fish";
import { useRemoveDevFishMutation } from "../api/use-remove-dev-fish-mutation";

export function TankScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { fish, totalCount, aliveCount, holdingCount } = useOwnedFish();
  const addDevFish = useAddDevFishMutation();
  const removeDevFish = useRemoveDevFishMutation();

  return (
    <View style={styles.root}>
      <TankCanvas fish={fish} style={StyleSheet.absoluteFill as never} />
      <View
        style={[
          styles.overlay,
          {
            paddingTop: insets.top + spacing.sm,
            paddingLeft: insets.left + spacing.md,
            paddingRight: insets.right + spacing.md,
          },
        ]}
      >
        <View style={styles.headerCard}>
          <Text style={styles.title}>Your Tank</Text>
          <Text style={styles.subtitle}>
            {aliveCount} {aliveCount === 1 ? "molly" : "mollies"} thriving
            {totalCount - aliveCount > 0 ? ` · ${totalCount - aliveCount} lost` : ""}
            {holdingCount > 0 ? ` · ${holdingCount} in holding tank` : ""}
          </Text>
          <Pressable style={styles.manageButton} onPress={() => router.push("/holding-tank")}>
            <Text style={styles.manageButtonText}>Manage tank</Text>
          </Pressable>
          {__DEV__ ? (
            <View style={styles.devRow}>
              <Pressable
                style={styles.devButton}
                onPress={() => addDevFish.mutate()}
                disabled={addDevFish.isPending}
              >
                <Text style={styles.devButtonText}>DEV: add a fish</Text>
              </Pressable>
              <Pressable
                style={styles.devButton}
                onPress={() => removeDevFish.mutate()}
                disabled={removeDevFish.isPending || fish.length === 0}
              >
                <Text style={styles.devButtonText}>DEV: remove a fish</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </View>
      {totalCount === 0 ? (
        <View style={styles.emptyOverlay} pointerEvents="none">
          <EmptyState
            emoji="🫧"
            title="Your tank is empty"
            caption="Complete a focus session to raise your first molly."
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.waterBottom },
  overlay: {},
  headerCard: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(4, 18, 29, 0.55)",
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: 2,
  },
  title: { color: palette.text, fontSize: 20, fontWeight: "700" },
  subtitle: { color: palette.textDim, fontSize: 13 },
  manageButton: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginTop: spacing.xs,
  },
  manageButtonText: { color: palette.textFaint, fontSize: 11, fontWeight: "600" },
  devRow: {
    flexDirection: "row",
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  devButton: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  devButtonText: { color: palette.textFaint, fontSize: 11, fontWeight: "600" },
  emptyOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
  },
});
