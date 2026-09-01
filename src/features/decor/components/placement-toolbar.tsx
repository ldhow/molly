import { Pressable, StyleSheet, Text, View } from "react-native";

import { palette, radius, spacing } from "@/shared/constants/theme";
import type { DecorItemDef, DecorLayer } from "@/shared/decor/types";

import { MAX_X_FRACTION, MIN_X_FRACTION, POSITION_STEP, SCALE_STEP } from "../constants";

export interface PlacementState {
  layer: DecorLayer;
  xFraction: number;
  scale: number;
  mirror: boolean;
  sortOrder: number;
}

interface Props {
  def: DecorItemDef;
  state: PlacementState;
  onChange: (next: PlacementState) => void;
  onPutAway: () => void;
  /** What reselling this item pays out — always less than what it cost, see
   *  `shared/decor/pricing.ts`. */
  resalePrice: number;
  onResell: () => void;
}

const LAYER_LABEL: Record<DecorLayer, string> = {
  back: "Back",
  backMid: "Back+",
  mid: "Mid",
  frontMid: "Mid+",
  front: "Front",
  frontMost: "Front+",
};

/** Canonical depth order, farthest to nearest — matches `SceneLayer`'s draw
 *  order in `aquarium-canvas.tsx`. Used to step to the next/previous tier a
 *  given item is actually allowed to sit in (`def.layers`), not just the
 *  next tier in the full 6-tier list — most items don't allow all 6. */
const LAYER_ORDER: readonly DecorLayer[] = [
  "back",
  "backMid",
  "mid",
  "frontMid",
  "front",
  "frontMost",
];

function stepLayer(current: DecorLayer, allowed: readonly DecorLayer[], delta: number): DecorLayer {
  const ordered = LAYER_ORDER.filter((layer) => allowed.includes(layer));
  if (ordered.length === 0) return current;
  const index = ordered.indexOf(current);
  const next = ordered[(index + delta + ordered.length) % ordered.length];
  return next ?? ordered[0];
}

/** Controls for the currently selected decor item — this IS the "place" in
 *  the Decor Store loop: layer, position, size, flip, draw order, and
 *  putting the item back in the bag. Every control commits immediately
 *  (the mutations are optimistic), so the tank updates as you tap. */
export function PlacementToolbar({
  def,
  state,
  onChange,
  onPutAway,
  resalePrice,
  onResell,
}: Props) {
  const move = (delta: number) =>
    onChange({
      ...state,
      xFraction: Math.min(MAX_X_FRACTION, Math.max(MIN_X_FRACTION, state.xFraction + delta)),
    });
  const rescale = (delta: number) =>
    onChange({
      ...state,
      scale: Math.min(def.maxScale, Math.max(def.minScale, state.scale + delta)),
    });
  const reorder = (delta: number) => onChange({ ...state, sortOrder: state.sortOrder + delta });

  return (
    <View style={styles.card}>
      <Text style={styles.name}>{def.name}</Text>

      {def.layers.length > 1 ? (
        <View style={styles.row}>
          <Text style={styles.label}>Depth</Text>
          <View style={styles.stepper}>
            <Pressable
              style={styles.stepButton}
              onPress={() => onChange({ ...state, layer: stepLayer(state.layer, def.layers, -1) })}
            >
              <Text style={styles.stepButtonText}>◀</Text>
            </Pressable>
            <Text style={[styles.stepValue, styles.stepValueWide]}>{LAYER_LABEL[state.layer]}</Text>
            <Pressable
              style={styles.stepButton}
              onPress={() => onChange({ ...state, layer: stepLayer(state.layer, def.layers, 1) })}
            >
              <Text style={styles.stepButtonText}>▶</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <View style={styles.row}>
        <Text style={styles.label}>Position</Text>
        <View style={styles.stepper}>
          <Pressable style={styles.stepButton} onPress={() => move(-POSITION_STEP)}>
            <Text style={styles.stepButtonText}>◀</Text>
          </Pressable>
          <Text style={styles.stepValue}>{Math.round(state.xFraction * 100)}%</Text>
          <Pressable style={styles.stepButton} onPress={() => move(POSITION_STEP)}>
            <Text style={styles.stepButtonText}>▶</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>Size</Text>
        <View style={styles.stepper}>
          <Pressable style={styles.stepButton} onPress={() => rescale(-SCALE_STEP)}>
            <Text style={styles.stepButtonText}>−</Text>
          </Pressable>
          <Text style={styles.stepValue}>{state.scale.toFixed(2)}×</Text>
          <Pressable style={styles.stepButton} onPress={() => rescale(SCALE_STEP)}>
            <Text style={styles.stepButtonText}>+</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.row}>
        <Pressable
          style={[styles.toggle, state.mirror && styles.toggleActive]}
          onPress={() => onChange({ ...state, mirror: !state.mirror })}
        >
          <Text style={styles.toggleText}>Flip</Text>
        </Pressable>
        <Pressable style={styles.toggle} onPress={() => reorder(-1)}>
          <Text style={styles.toggleText}>Send back</Text>
        </Pressable>
        <Pressable style={styles.toggle} onPress={() => reorder(1)}>
          <Text style={styles.toggleText}>Bring forward</Text>
        </Pressable>
      </View>

      <View style={styles.row}>
        <Pressable style={styles.putAway} onPress={onPutAway}>
          <Text style={styles.putAwayText}>Put away</Text>
        </Pressable>
        <Pressable style={styles.sell} onPress={onResell}>
          <Text style={styles.sellText}>Sell for 🪙 {resalePrice}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  name: { color: palette.text, fontSize: 15, fontWeight: "700" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  label: { color: palette.textDim, fontSize: 12, fontWeight: "600" },
  stepper: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  stepButton: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: "center",
    justifyContent: "center",
  },
  stepButtonText: { color: palette.text, fontSize: 14, fontWeight: "700" },
  stepValue: {
    color: palette.text,
    fontSize: 13,
    fontWeight: "600",
    width: 44,
    textAlign: "center",
  },
  stepValueWide: { width: 56 },
  toggle: {
    flex: 1,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.pill,
    paddingVertical: spacing.xs,
    alignItems: "center",
  },
  toggleActive: { backgroundColor: palette.accentDark, borderColor: palette.accent },
  toggleText: { color: palette.textDim, fontSize: 11, fontWeight: "600" },
  putAway: { flex: 1, alignItems: "center", paddingVertical: spacing.xs },
  putAwayText: { color: palette.danger, fontSize: 12, fontWeight: "700" },
  sell: {
    flex: 1,
    alignItems: "center",
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.pill,
  },
  sellText: { color: palette.warning, fontSize: 12, fontWeight: "700" },
});
