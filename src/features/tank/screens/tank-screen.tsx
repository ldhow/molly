import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CoinChip } from "@/shared/components/coin-chip";
import { EmptyState } from "@/shared/components/empty-state";
import { TankView } from "@/shared/components/tank/tank-view";
import { palette, radius, spacing } from "@/shared/constants/theme";
import { useOwnedFish } from "@/shared/hooks/use-owned-fish";
import { useUserScape } from "@/shared/hooks/use-user-scape";
import { useRenderModeStore, type RenderMode } from "@/shared/store/render-mode-store";

/** Toggles between the two renderers. */
const NEXT_RENDER_MODE: Record<RenderMode, RenderMode> = {
  v2: "3d",
  "3d": "v2",
};

const RENDER_MODE_LABEL: Record<RenderMode, string> = {
  v2: "2D",
  "3d": "3D",
};

export function TankScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { fish, totalCount } = useOwnedFish();
  const renderMode = useRenderModeStore((s) => s.renderMode);
  const setRenderMode = useRenderModeStore((s) => s.setRenderMode);
  const userScape = useUserScape();
  // Collapsed by default: the tank IS the screen, and an always-open action
  // list was sitting on top of the fish it's meant to be a menu FOR. See
  // `menuToggle`'s comment for why this is a `Pressable` overlay rather than,
  // say, a bottom sheet — the tank behind it should stay visible either way.
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <View style={styles.root}>
      <TankView
        fish={fish}
        style={StyleSheet.absoluteFill as never}
        userScape={userScape}
        pannable
      />
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
        {/* No title, no counts, no card background — the tank IS the
            content, and the tab bar already says "Tank". Just the two
            things that need to float on top of it: balance, and a way to
            reach everything else. Pinned to the right: a right-handed player
            reaches the right edge of the screen without their thumb crossing
            (and hiding) the tank. */}
        <View style={styles.headerRow}>
          <CoinChip />
          <Pressable style={styles.menuToggle} onPress={() => setMenuOpen((v) => !v)} hitSlop={8}>
            <Text style={styles.menuToggleText}>{menuOpen ? "✕" : "☰"}</Text>
          </Pressable>
        </View>
        {menuOpen ? (
          // A vertical stack of full-width rows, not the old wrapped pill
          // grid: each row is a single generous tap target (48pt tall, the
          // Android/iOS accessibility floor) instead of several small pills
          // packed edge to edge, which is where a mis-tap used to happen.
          <View style={styles.actionsCard}>
            <Pressable style={styles.manageButton} onPress={() => router.push("/holding-tank")}>
              <Text style={styles.manageButtonText}>Manage tank</Text>
            </Pressable>
            <Pressable style={styles.manageButton} onPress={() => router.push("/sell-fish")}>
              <Text style={styles.manageButtonText}>🪙 Sell Fish</Text>
            </Pressable>
            <Pressable style={styles.manageButton} onPress={() => router.push("/decor-store")}>
              <Text style={styles.manageButtonText}>Decor Store</Text>
            </Pressable>
            <Pressable style={styles.manageButton} onPress={() => router.push("/decorate")}>
              <Text style={styles.manageButtonText}>Decorate</Text>
            </Pressable>
            <Pressable
              style={[styles.manageButton, renderMode === "3d" && styles.manageButtonActive]}
              onPress={() => setRenderMode(NEXT_RENDER_MODE[renderMode])}
            >
              <Text style={styles.manageButtonText}>Renderer: {RENDER_MODE_LABEL[renderMode]}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
      {totalCount === 0 ? (
        <View style={styles.emptyOverlay} pointerEvents="none">
          <EmptyState
            emoji="🫧"
            title="Your tank is empty"
            caption="Complete a focus session to raise your first companion."
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.waterBottom },
  // `alignItems: "flex-end"` (not each child's own `alignSelf`) so the
  // header row AND the actions card below it share one right edge — an
  // `alignSelf` per child lets a wider one drift the narrower one's edge
  // when their natural widths differ.
  overlay: { alignItems: "flex-end" },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  menuToggle: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: "center",
    justifyContent: "center",
  },
  menuToggleText: { color: palette.text, fontSize: 20, fontWeight: "700" },
  actionsCard: {
    minWidth: 190,
    backgroundColor: "rgba(4, 18, 29, 0.55)",
    borderRadius: radius.md,
    padding: spacing.xs,
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  manageButton: {
    minHeight: 48,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  manageButtonActive: {
    backgroundColor: palette.accentDark,
    borderColor: palette.accent,
  },
  manageButtonText: { color: palette.text, fontSize: 14, fontWeight: "600" },
  emptyOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
  },
});
