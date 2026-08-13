import React, { useMemo } from "react";
import { Group, Path } from "@shopify/react-native-skia";
import { useDerivedValue, useFrameCallback, useSharedValue } from "react-native-reanimated";
import { catmullToPath, finishPath, newPathBuilder, TWO_PI } from "./fishMath";

/**
 * A snail is NOT a fish with different widths — it needs its own locomotion model.
 *
 * Real snails glide on a muscular foot using pedal waves: bands of contraction
 * travelling along the sole, at roughly 1.3 cm/min. The shell never deforms.
 * So: a rigid shell, a foot whose lower edge ripples, and tentacles that sway
 * and retract when something passes close.
 *
 * `railT` runs 0..1 along whatever surface the snail is stuck to. Feed it a
 * function that maps 0..1 to a point and a surface normal, and the same
 * component works on the substrate, the glass, or a plant stem.
 */
export function Snail({
  x, y, size = 26, facing = 1, threat,
}: {
  x: number;
  y: number;
  size?: number;
  facing?: 1 | -1;
  /** Distance in px to the nearest fish; drives tentacle retraction. */
  threat?: { value: number };
}) {
  const t = useSharedValue(0);
  const retract = useSharedValue(1);

  useFrameCallback((info) => {
    "worklet";
    const dt = Math.min(0.05, (info.timeSincePreviousFrame ?? 16) / 1000);
    t.value += dt;
    const near = threat ? threat.value < 30 : false;
    const target = near ? 0.2 : 1;
    // Retract fast, extend slowly — that asymmetry is what makes it read as alarm.
    retract.value += (target - retract.value) * Math.min(1, (near ? 12 : 2.5) * dt);
  });

  /** Shell: a logarithmic spiral, built once. Rigid by definition. */
  const shell = useMemo(() => {
    const b = newPathBuilder();
    const turns = 2.75;
    const steps = 90;
    const pts: number[] = [];
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * turns * TWO_PI;
      const r = size * 0.18 * Math.exp(0.22 * a);
      pts.push(Math.cos(a) * r * facing, Math.sin(a) * r - size * 0.35);
    }
    b.moveTo(pts[0], pts[1]);
    for (let i = 1; i < pts.length / 2; i++) b.lineTo(pts[i * 2], pts[i * 2 + 1]);
    return finishPath(b);
  }, [size, facing]);

  /** Foot: the lower edge carries 3 travelling ripples. A few px is enough. */
  const foot = useDerivedValue(() => {
    "worklet";
    const pts: number[] = [];
    const w = size * 1.5;
    const h = size * 0.42;
    const n = 22;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const px = (-0.5 + u) * w * facing;
      // top edge of the foot: smooth dome
      pts.push(px, -Math.sin(u * Math.PI) * h * 0.5);
    }
    for (let i = n; i >= 0; i--) {
      const u = i / n;
      const px = (-0.5 + u) * w * facing;
      const ripple = Math.sin(TWO_PI * (3 * u - 0.6 * t.value)) * 1.6;
      pts.push(px, h * 0.5 + ripple);
    }
    const b = newPathBuilder();
    catmullToPath(b, pts, pts.length / 2, true);
    return finishPath(b);
  });

  /** Two eye stalks and two shorter feelers, swaying and retracting. */
  const tentacles = useDerivedValue(() => {
    "worklet";
    const b = newPathBuilder();
    const r = retract.value;
    const mk = (len: number, lift: number, phase: number, thick: number) => {
      "worklet";
      const sway = Math.sin(t.value * 0.9 + phase) * 0.22;
      const bx = size * 0.62 * facing;
      const by = 0;
      const tipx = bx + Math.cos(-lift + sway) * len * r * facing;
      const tipy = by + Math.sin(-lift + sway) * len * r;
      b.moveTo(bx, by - thick);
      b.quadTo(bx + (tipx - bx) * 0.5 * 1.1, by + (tipy - by) * 0.4, tipx, tipy);
      b.quadTo(bx + (tipx - bx) * 0.5, by + (tipy - by) * 0.5, bx, by + thick);
      b.close();
    };
    mk(size * 0.75, 0.9, 0, size * 0.055);   // upper eye stalk
    mk(size * 0.42, 0.15, 1.7, size * 0.045); // lower feeler
    return finishPath(b);
  });

  return (
    <Group transform={[{ translateX: x }, { translateY: y }]}>
      <Path path={foot} color="#C9A98C" />
      <Path path={tentacles} color="#C9A98C" style="fill" />
      <Path path={shell} color="#8A5A32" style="stroke" strokeWidth={size * 0.26} strokeCap="round" />
      <Path path={shell} color="#B07A45" style="stroke" strokeWidth={size * 0.1} strokeCap="round" />
    </Group>
  );
}
