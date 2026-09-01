"use no memo"; // useSharedValue/useAnimatedStyle-driven ghost — same reasoning
// as the aquarium renderer's sway animations (see e.g. sprite-layers.tsx).

import { Image } from "expo-image";
import { useState, type PropsWithChildren } from "react";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from "react-native-reanimated";

import { SPRITE_SOURCES } from "@/shared/aquarium";
import type { DecorItemDef } from "@/shared/decor/types";

import { MAX_X_FRACTION, MIN_X_FRACTION } from "../constants";

/** The minimal shape needed to hit-test a tap against a drawn piece — see
 *  `AquariumCanvas`'s `composeSpriteScene` re-export doc for where this
 *  comes from (the exact same composition the canvas renders from). */
export interface HitTestPiece {
  key: string;
  worldX: number;
  worldY: number;
  rect: { x: number; y: number; width: number; height: number };
}

interface Props {
  /** The item currently selected for editing. Dragging only does anything
   *  while this is set — with nothing selected, a drag gesture has nothing
   *  to do, so it loses the `Gesture.Race` below to tap-to-select every time. */
  selectedDef: DecorItemDef | null;
  onDragEnd: (xFraction: number) => void;
  /** Hit-testable pieces for tap-to-select. Omit to disable it (falls back
   *  to select-from-the-inventory-strip only). */
  pieces?: readonly HitTestPiece[];
  /** Called with the tapped piece's key, or `null` if the tap landed on open
   *  water (tapping empty space deselects). */
  onSelectAt?: (key: string | null) => void;
  /** Fires `true` the moment a drag actually starts and `false` when it
   *  ends — lets the caller hide its own overlay UI (a toolbar popup,
   *  say) for the duration, so it can never cover the ghost or the item
   *  being positioned. */
  onDraggingChange?: (dragging: boolean) => void;
}

const GHOST_SIZE = 64;

function hitTest(pieces: readonly HitTestPiece[], x: number, y: number): string | null {
  // Reverse order: later entries in a composed scene draw on top (higher
  // sortOrder), so they should win a tap that lands on an overlap.
  for (let i = pieces.length - 1; i >= 0; i--) {
    const piece = pieces[i];
    const left = piece.worldX + piece.rect.x;
    const top = piece.worldY + piece.rect.y;
    if (x >= left && x <= left + piece.rect.width && y >= top && y <= top + piece.rect.height) {
      return piece.key;
    }
  }
  return null;
}

/**
 * Wraps the live tank with two gestures racing on the same touch — RNGH's
 * standard tap-vs-pan split, so a stationary touch resolves as a tap
 * (select) and a moving one resolves as a pan (reposition), never both:
 *
 * - Drag (only while an item is selected): moves it. There's no per-sprite
 *   hit-testing for THIS gesture — re-running `composeSpriteScene` and
 *   hit-testing every frame of a drag would be real per-frame cost for no
 *   visible gain over "wherever you press, the selected item goes there,
 *   snapped on release" (a floating `expo-image` ghost tracks the finger;
 *   the real Skia piece only moves once, via the already-optimistic
 *   `usePlaceDecorMutation`).
 * - Tap (always live): hit-tests `pieces` ONCE per tap (cheap, not per
 *   frame) to select whichever item is under the finger, or deselect if the
 *   tap landed on open water — this IS "grab the piece under your finger",
 *   just for selection rather than for tracking a drag.
 */
export function DragCanvas({
  children,
  selectedDef,
  onDragEnd,
  pieces,
  onSelectAt,
  onDraggingChange,
}: PropsWithChildren<Props>) {
  const [width, setWidth] = useState(0);
  const widthSV = useSharedValue(0);
  const dragging = useSharedValue(false);
  const ghostX = useSharedValue(0);
  const ghostY = useSharedValue(0);

  const commit = (fraction: number) => {
    onDragEnd(Math.min(MAX_X_FRACTION, Math.max(MIN_X_FRACTION, fraction)));
  };
  const select = (x: number, y: number) => {
    onSelectAt?.(hitTest(pieces ?? [], x, y));
  };
  const notifyDragging = (value: boolean) => {
    onDraggingChange?.(value);
  };

  const pan = Gesture.Pan()
    .enabled(selectedDef !== null)
    .onBegin((e) => {
      dragging.value = true;
      ghostX.value = e.x;
      ghostY.value = e.y;
      runOnJS(notifyDragging)(true);
    })
    .onUpdate((e) => {
      ghostX.value = e.x;
      ghostY.value = e.y;
    })
    .onEnd((e) => {
      dragging.value = false;
      runOnJS(notifyDragging)(false);
      if (widthSV.value > 0) runOnJS(commit)(e.x / widthSV.value);
    })
    .onFinalize(() => {
      dragging.value = false;
      runOnJS(notifyDragging)(false);
    });

  const tap = Gesture.Tap()
    .enabled(onSelectAt !== undefined)
    .onEnd((e) => {
      runOnJS(select)(e.x, e.y);
    });

  const gesture = Gesture.Race(pan, tap);

  const ghostStyle = useAnimatedStyle(() => ({
    opacity: dragging.value ? 1 : 0,
    transform: [
      { translateX: ghostX.value - GHOST_SIZE / 2 },
      { translateY: ghostY.value - GHOST_SIZE / 2 },
    ],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <View
        style={styles.root}
        onLayout={(e) => {
          const w = e.nativeEvent.layout.width;
          setWidth(w);
          widthSV.value = w;
        }}
      >
        {children}
        {selectedDef && width > 0 ? (
          <Animated.View style={[styles.ghost, ghostStyle]} pointerEvents="none">
            <Image
              source={SPRITE_SOURCES[selectedDef.id]}
              style={styles.ghostImage}
              contentFit="contain"
            />
          </Animated.View>
        ) : null}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  ghost: {
    position: "absolute",
    top: 0,
    left: 0,
    width: GHOST_SIZE,
    height: GHOST_SIZE,
  },
  ghostImage: { width: "100%", height: "100%", opacity: 0.85 },
});
