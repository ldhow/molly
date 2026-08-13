import React, { useMemo } from "react";
import { Circle, Group, LinearGradient, Path, vec } from "@shopify/react-native-skia";
import { useDerivedValue, type SharedValue } from "react-native-reanimated";
import type { Species } from "./species";
import {
  NODE, STRIDE, S_X, S_Y, S_HEADING, S_SPEED, S_PHASE, S_TURN, S_AMP,
  buildBodyPath, buildCaudalPath, buildCaudalRays, buildCrestPath,
  buildBellyPath, buildGillPath, buildMouthPath,
  buildPectoralPath, buildSpine, caudalTip, clamp, eyeXY,
} from "./fishMath";

/**
 * One deformed fish (tier 1: full undulation, up to ~15 on screen).
 *
 * Draw order matters — the body must occlude the far-side pectoral or the fish
 * reads as flat: far pectoral -> caudal -> dorsal -> anal -> body -> near
 * pectoral -> eye.
 */
export function Fish({
  index, spec, state, frame, time, scale, z,
}: {
  index: number;
  spec: Species;
  state: SharedValue<Float32Array>;
  frame: SharedValue<number>;
  /** Monotonic seconds from useSchool. */
  time: SharedValue<number>;
  scale: number;
  z: number;
}) {
  // Scratch buffers allocated once per fish and mutated in place. Allocating
  // these inside the derived value is the single biggest avoidable cost here.
  const spine = useMemo(() => new Float32Array(spec.segments * NODE), [spec.segments]);
  const pts = useMemo(() => new Array<number>((spec.segments * 2 + 8) * 2).fill(0), [spec.segments]);

  // Reading frame.value registers the dependency. Reanimated does not observe
  // in-place mutation of the Float32Array, so without this line the fish freezes.
  const sync = () => {
    "worklet";
    frame.value;
    const o = index * STRIDE;
    const b = state.value;
    buildSpine(
      spine, spec, b[o + S_X], b[o + S_Y], b[o + S_HEADING],
      b[o + S_PHASE], b[o + S_TURN], scale, b[o + S_AMP]
    );
    return b;
  };

  const body = useDerivedValue(() => {
    "worklet";
    sync();
    return buildBodyPath(spine, spec, pts);
  });

  const caudal = useDerivedValue(() => {
    "worklet";
    sync();
    return buildCaudalPath(spine, spec, scale, pts);
  });

  const dorsal = useDerivedValue(() => {
    "worklet";
    sync();
    return buildCrestPath(spine, spec, spec.dorsal, -1, scale, pts);
  });

  const anal = useDerivedValue(() => {
    "worklet";
    sync();
    if (!spec.anal) return buildCrestPath(spine, spec, { span: [0, 0], height: 0, peak: 0.5 }, 1, scale, pts);
    return buildCrestPath(spine, spec, spec.anal, 1, scale, pts);
  });

  const pecFar = useDerivedValue(() => {
    "worklet";
    const b = sync();
    const o = index * STRIDE;
    const ratio = clamp(b[o + S_SPEED] / spec.motion.cruise, 0, 1);
    return buildPectoralPath(spine, spec, -1, time.value, ratio, scale, pts);
  });

  const pecNear = useDerivedValue(() => {
    "worklet";
    const b = sync();
    const o = index * STRIDE;
    const ratio = clamp(b[o + S_SPEED] / spec.motion.cruise, 0, 1);
    return buildPectoralPath(spine, spec, 1, time.value, ratio, scale, pts);
  });

  const bellyShade = useDerivedValue(() => {
    "worklet";
    sync();
    return buildBellyPath(spine, spec, pts);
  });
  const gill = useDerivedValue(() => {
    "worklet";
    sync();
    return buildGillPath(spine, spec);
  });
  const mouth = useDerivedValue(() => {
    "worklet";
    sync();
    return buildMouthPath(spine, spec);
  });

  // Caudal fin gradient runs base -> tip. Fins are membranes: light passes
  // through them and they fade toward the trailing edge. An opaque fin is the
  // clearest signal that a fish was generated rather than drawn.
  const finBase = useDerivedValue(() => {
    "worklet";
    sync();
    const i = spec.segments - 1;
    return vec(spine[i * NODE], spine[i * NODE + 1]);
  });
  const finTip = useDerivedValue(() => {
    "worklet";
    sync();
    const p = caudalTip(spine, spec, scale);
    return vec(p.x, p.y);
  });
  const rays = useDerivedValue(() => {
    "worklet";
    sync();
    return buildCaudalRays(spine, spec, scale);
  });

  // Banking: fish roll into a turn, so we see them more edge-on. Squashing
  // perpendicular to the heading fakes that roll convincingly in pure 2D, and
  // it is the single cheapest thing that stops a flat side-on fish reading flat.
  const bank = useDerivedValue(() => {
    "worklet";
    frame.value;
    const b = state.value;
    const o = index * STRIDE;
    const roll = clamp(b[o + S_TURN] * 0.9, -1, 1);
    const h = b[o + S_HEADING];
    return [{ rotate: h }, { scaleY: 1 - 0.38 * Math.abs(roll) }, { rotate: -h }];
  });
  const bankOrigin = useDerivedValue(() => {
    "worklet";
    frame.value;
    const b = state.value;
    const o = index * STRIDE;
    return vec(b[o + S_X], b[o + S_Y]);
  });

  const eye = useDerivedValue(() => {
    "worklet";
    sync();
    return eyeXY(spine, spec, -1);
  });
  const eyeCx = useDerivedValue(() => eye.value.x);
  const eyeCy = useDerivedValue(() => eye.value.y);
  const eyeR = useDerivedValue(() => eye.value.r);
  const pupilR = useDerivedValue(() => eye.value.r * 0.55);
  // Catchlight. Two extra circles, and the fish stops looking dead.
  const hlCx = useDerivedValue(() => eye.value.x - eye.value.r * 0.3);
  const hlCy = useDerivedValue(() => eye.value.y - eye.value.r * 0.3);
  const hlR = useDerivedValue(() => eye.value.r * 0.22);

  // Depth: distant fish are smaller, paler and hazier.
  const opacity = 0.55 + z * 0.45;

  return (
    <Group opacity={opacity} transform={bank} origin={bankOrigin}>
      <Path path={pecFar} color={spec.fin} opacity={0.5} />
      <Path path={caudal}>
        <LinearGradient start={finBase} end={finTip} colors={[spec.fin + "E6", spec.fin + "59"]} />
      </Path>
      <Path path={rays} color={spec.fin} style="stroke"
            strokeWidth={Math.max(0.6, spec.length * scale * 0.012)}
            strokeCap="round" opacity={0.45} />
      <Path path={dorsal} color={spec.fin} opacity={0.82} />
      <Path path={anal} color={spec.fin} opacity={0.82} />
      <Path path={body} color={spec.body} />
      <Path path={bellyShade} color={spec.belly} opacity={0.5} />
      <Path path={gill} color="#000000" style="stroke"
            strokeWidth={Math.max(0.5, spec.length * scale * 0.012)} opacity={0.16} />
      <Path path={mouth} color="#000000" style="stroke"
            strokeWidth={Math.max(0.5, spec.length * scale * 0.014)}
            strokeCap="round" opacity={0.3} />
      <Path path={pecNear} color={spec.fin} opacity={0.65} />
      <Circle cx={eyeCx} cy={eyeCy} r={eyeR} color="#FFFFFF" />
      <Circle cx={eyeCx} cy={eyeCy} r={pupilR} color={spec.eye} />
      <Circle cx={hlCx} cy={hlCy} r={hlR} color="#FFFFFF" />
    </Group>
  );
}
