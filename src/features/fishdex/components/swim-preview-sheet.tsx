// The Fishdex's "how does this one actually move?" view.
//
// Every other fish surface in the Fishdex is a STATIC baked PNG
// (`FishPreview`/`CreaturePreview` through `render/baked-uri.ts`), because a
// grid of live Skia canvases costs a native view plus an EGL window surface
// per tile. That trade is right for a grid and wrong for a detail view: the
// swim model — undulation, burst-and-coast, wall turns, the snail's crawl —
// is most of what distinguishes one species from another, and none of it
// survives a still frame.
//
// So this is the one place in the Fishdex that mounts a real animated canvas,
// and it mounts exactly one at a time.

import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TankView } from "@/shared/components/tank/tank-view";
import { palette, radius, spacing } from "@/shared/constants/theme";
import { getSpeciesDef } from "@/shared/creature/catalog";
import type { SpeciesId } from "@/shared/creature/types";
import { formatRarity, RARITY_COLORS } from "@/shared/fish/rarity";
import type { FishTraits, Rarity } from "@/shared/fish/types";
import { DEV_SPAWN_FISH } from "@/shared/lib/dev-flags";
import type { AnyTankFish } from "@/shared/lib/tank-fish";
import { seedFromString } from "@/shared/lib/seed";

import { useDevSpawnFishMutation } from "../api/use-dev-spawn-fish-mutation";

export interface SwimPreviewTarget {
  /** Stable identity for the seed, so reopening the same entry replays the same personality. */
  id: string;
  title: string;
  subtitle?: string;
  rarity?: Rarity;
  fish: AnyTankFish;
}

/** A molly colour, at its standard body/tail/dorsal. */
export function mollyTarget(args: {
  colorId: string;
  traits: FishTraits;
  title: string;
  subtitle?: string;
  rarity?: Rarity;
}): SwimPreviewTarget {
  return {
    id: args.colorId,
    title: args.title,
    subtitle: args.subtitle,
    rarity: args.rarity,
    fish: {
      key: `preview-${args.colorId}`,
      speciesId: "molly",
      traits: args.traits,
      stage: "adult",
      status: "alive",
      // 1, not the tank's shrunk scale: this is a detail view and the fish is
      // the subject. `mode="center"` keeps it clear of the chrome below.
      scale: 1,
      seed: seedFromString(args.colorId),
    },
  };
}

/** One creature variant. */
export function creatureTarget(args: {
  speciesId: Exclude<SpeciesId, "molly">;
  variant: string;
  title: string;
  subtitle?: string;
  rarity?: Rarity;
}): SwimPreviewTarget {
  return {
    id: `${args.speciesId}:${args.variant}`,
    title: args.title,
    subtitle: args.subtitle,
    rarity: args.rarity,
    fish: {
      key: `preview-${args.speciesId}-${args.variant}`,
      speciesId: args.speciesId,
      variant: args.variant,
      stage: "adult",
      status: "alive",
      // Species differ in real size and the swim tuning is keyed off it, so a
      // preview that normalised every animal to 1 would misrepresent both.
      scale: getSpeciesDef(args.speciesId).sizeRatio,
      seed: seedFromString(`${args.speciesId}:${args.variant}`),
    },
  };
}

/**
 * Portrait stacks the canvas over the text; landscape puts them side by side.
 *
 * Not cosmetic. A fixed 260pt canvas plus the text block is ~396pt of content
 * against ~346pt of usable height on a phone in landscape, and a card centred
 * in the backdrop that overflows gets clipped at BOTH ends — which is why the
 * preview was unreachable in that orientation rather than merely ugly. Sizing
 * off the live window is also what keeps it right on a tablet and across a
 * rotation that happens while the sheet is already open.
 */
export function SwimPreviewSheet({
  target,
  onClose,
}: {
  target: SwimPreviewTarget | null;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const spawn = useDevSpawnFishMutation();
  // `visible={false}` unmounts the children, which is what actually releases
  // the canvas and its swim frame callback — the reason this takes a nullable
  // target rather than being conditionally rendered by the parent is just so
  // the modal's own dismiss animation has something to animate out.
  const visible = target !== null;

  const landscape = winW > winH;
  const availW = winW - insets.left - insets.right - spacing.lg * 2;
  const availH = winH - insets.top - insets.bottom - spacing.lg * 2;
  const cardW = Math.min(landscape ? 720 : 480, availW);
  const cardH = Math.min(landscape ? 360 : 520, availH);
  // Landscape gives the canvas the card's full height and roughly half its
  // width; portrait caps it at half the usable height, with a floor so the
  // fish still has room to swim rather than twitch in place.
  const canvasH = landscape ? cardH : Math.max(150, Math.min(260, Math.round(availH * 0.5)));
  const canvasW = landscape ? Math.round(cardW * 0.52) : cardW;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      /**
       * REQUIRED, not a nicety. React Native's own iOS code locks a modal to
       * portrait when this prop is absent — `RCTModalHostView`'s
       * `supportedOrientationsMask` returns `UIInterfaceOrientationMaskPortrait`
       * for an empty list on iPhone (iPad gets `MaskAll`, which is why this
       * looks fine on a tablet). The app's own `orientation: "default"` does
       * not reach inside the modal's view controller, so without this the
       * sheet is the one screen that refuses to rotate. Android ignores the
       * prop — its Modal is a Dialog on the activity and follows it.
       */
      supportedOrientations={[
        "portrait",
        "portrait-upside-down",
        "landscape-left",
        "landscape-right",
      ]}
    >
      <Pressable
        style={[
          styles.backdrop,
          {
            // Insets, not a flat pad: in landscape the notch is on the side,
            // and a centred card can otherwise sit under it.
            paddingTop: insets.top + spacing.lg,
            paddingBottom: insets.bottom + spacing.lg,
            paddingLeft: insets.left + spacing.lg,
            paddingRight: insets.right + spacing.lg,
          },
        ]}
        onPress={onClose}
        accessibilityLabel="Close preview"
      >
        {/* Swallow taps on the card so only the backdrop dismisses. */}
        <Pressable
          style={[styles.card, landscape && styles.cardRow, { width: cardW, maxHeight: cardH }]}
          onPress={() => {}}
        >
          <View style={[styles.canvas, { width: canvasW, height: canvasH }]}>
            {target ? (
              <TankView
                mode="center"
                // No sand, decor or bubbles: the subject is the animal, and a
                // full scene at this size reads as a cramped tank rather than
                // a specimen view.
                background="plain"
                // The whole point of this sheet is the 2D swim model, and 3D
                // has no art for five of the six species — see `force2D`.
                force2D
                style={StyleSheet.absoluteFill as never}
                fish={[target.fish]}
              />
            ) : null}
          </View>
          <View style={[styles.side, landscape && styles.sideRow]}>
            <View style={styles.meta}>
              <Text style={styles.title}>{target?.title ?? ""}</Text>
              {target?.rarity ? (
                <Text style={[styles.rarity, { color: RARITY_COLORS[target.rarity.tier] }]}>
                  {formatRarity(target.rarity)}
                </Text>
              ) : null}
              {target?.subtitle ? (
                // Clamped rather than scrolled: a nested scroll view inside the
                // tap-swallowing Pressable fights the backdrop's gesture, and
                // the descriptions are short enough that truncation is rare.
                <Text style={styles.subtitle} numberOfLines={landscape ? 4 : 3}>
                  {target.subtitle}
                </Text>
              ) : null}
            </View>
            <View style={styles.actions}>
              {DEV_SPAWN_FISH && target ? (
                <Pressable
                  style={({ pressed }) => [styles.spawn, pressed && styles.pressed]}
                  disabled={spawn.isPending}
                  accessibilityRole="button"
                  onPress={() => {
                    // Close on success rather than optimistically: the tank
                    // reads the row back through the invalidated query, so
                    // dismissing early would show a tank that has not caught
                    // up yet.
                    spawn.mutate(target.fish, { onSuccess: onClose });
                  }}
                >
                  <Text style={styles.spawnText}>
                    {spawn.isPending ? "Adding..." : "DEV: add to tank"}
                  </Text>
                </Pressable>
              ) : null}
              <Pressable
                style={({ pressed }) => [styles.close, pressed && styles.pressed]}
                onPress={onClose}
              >
                <Text style={styles.closeText}>Close</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
    overflow: "hidden",
  },
  cardRow: { flexDirection: "row" },
  canvas: { backgroundColor: palette.surfaceAlt },
  /**
   * Portrait: the text block sits under the canvas. Landscape: it becomes the
   * right-hand column, and has to be allowed to flex — without it a long
   * description pushes the canvas off the side of the card.
   */
  side: { paddingBottom: spacing.md },
  sideRow: { flex: 1, justifyContent: "space-between", paddingBottom: spacing.lg },
  meta: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.xs / 2 },
  title: { color: palette.text, fontSize: 18, fontWeight: "700" },
  rarity: { fontSize: 11, fontWeight: "800" },
  subtitle: { color: palette.textFaint, fontSize: 12, lineHeight: 17 },
  actions: {
    flexDirection: "row",
    // Wraps rather than overflowing: the dev spawn button plus Close is wider
    // than the right-hand column gets on a small phone in landscape.
    flexWrap: "wrap",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
    marginRight: spacing.lg,
  },
  pressed: { opacity: 0.6 },
  spawn: {
    borderWidth: 1,
    borderColor: palette.accent,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
  },
  spawnText: { color: palette.accent, fontSize: 13, fontWeight: "700" },
  close: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
  },
  closeText: { color: palette.text, fontSize: 13, fontWeight: "700" },
});
