import { useMemo } from "react";
import { useFrameCallback, useSharedValue, type SharedValue } from "react-native-reanimated";
import { SPECIES, jitter, type Species } from "./species";
import {
  STRIDE, S_X, S_Y, S_HEADING, S_SPEED, S_PHASE, S_WANDER, S_BURST, S_TURN, S_IDLE, S_AMP,
  TWO_PI, clamp, shortestAngle,
} from "./fishMath";

/**
 * The steering layer. Everything is accumulated as a VECTOR and converted to a
 * desired heading once — blending in angle space wraps near +/-PI and launches
 * creatures out of the tank.
 *
 * State lives in one Float32Array that is mutated in place (no allocation per
 * frame). Reanimated only notices assignment, not mutation, so `frame` is
 * bumped each tick and read by every derived value to force recomputation.
 */

export interface Member {
  species: keyof typeof SPECIES | string;
  scale: number;
  beat: number;
  cruise: number;
  z: number;
}

const INERTIA = 2.6;      // dominant term; this is what makes a fish hold a line
const SEP_R = 32;         // separation radius, px
const NBR_R = 100;        // alignment/cohesion radius, px
const WALL_GAIN = 14;

export function useSchool(
  counts: Record<string, number>,
  width: number,
  height: number,
  /**
   * Bands reserved for UI. Creatures treat these as walls, so nothing important
   * ever swims under a header or a button bar. Cheap, and immediately obvious
   * in a real app the moment it is missing.
   */
  insets: { top: number; bottom: number } = { top: 0, bottom: 0 }
) {
  const members = useMemo<Member[]>(() => {
    const out: Member[] = [];
    for (const key of Object.keys(counts)) {
      for (let i = 0; i < counts[key]; i++) {
        const j = jitter();
        out.push({ species: key, scale: j.scale, beat: j.beat, cruise: j.cruise, z: j.z });
      }
    }
    return out;
  }, [counts]);

  // Static per-species motion params, flattened so the worklet can index them
  // cheaply instead of walking objects every frame.
  const specs = useMemo(() => members.map((m) => SPECIES[m.species] as Species), [members]);

  const state = useSharedValue(
    useMemo(() => {
      const buf = new Float32Array(members.length * STRIDE);
      const margin = Math.min(width, height) * 0.2;
      for (let i = 0; i < members.length; i++) {
        const m = SPECIES[members[i].species];
        const o = i * STRIDE;
        buf[o + S_X] = margin + Math.random() * (width - margin * 2);
        buf[o + S_Y] = (m.motion.band ?? 0.5) * height + (Math.random() - 0.5) * height * 0.2;
        buf[o + S_HEADING] = Math.random() * TWO_PI;
        buf[o + S_SPEED] = m.motion.cruise * members[i].cruise;
        buf[o + S_PHASE] = Math.random() * TWO_PI;
        buf[o + S_WANDER] = buf[o + S_HEADING];
        buf[o + S_BURST] = Math.random() * 2;
        buf[o + S_IDLE] = -(4 + Math.random() * 10);
        buf[o + S_AMP] = 1;
      }
      return buf;
    }, [members, width, height])
  );

  const frame = useSharedValue(0);
  /** Monotonic seconds. Fin motion must not be driven by the wrapped tail phase. */
  const time = useSharedValue(0);
  /** Write a tap here to trigger feeding/startle; z<0 means "no touch". */
  const touch = useSharedValue({ x: -1, y: -1, t: -1 });

  const margin = Math.min(width, height) * 0.16;

  useFrameCallback((info) => {
    "worklet";
    // First frame reports null; a backgrounded app returns a huge delta that
    // would teleport everything through the glass. Clamp both.
    const dt = clamp((info.timeSincePreviousFrame ?? 16) / 1000, 0.001, 0.05);
    const buf = state.value;
    const n = specs.length;
    time.value += dt;

    for (let i = 0; i < n; i++) {
      const o = i * STRIDE;
      const spec = specs[i];
      const mo = spec.motion;
      const mem = members[i];
      const x = buf[o + S_X];
      const y = buf[o + S_Y];
      const h = buf[o + S_HEADING];
      const cruise = mo.cruise * mem.cruise;

      let fx = Math.cos(h) * INERTIA;
      let fy = Math.sin(h) * INERTIA;

      // --- wander: random-walk a WORLD-space direction. A heading-relative
      // offset persists, and a persistent offset is a permanent turn (circles).
      // sqrt(dt) keeps the walk's variance frame-rate independent.
      const g = (Math.random() + Math.random() + Math.random() - 1.5) * 2;
      buf[o + S_WANDER] += g * mo.wanderRate * Math.sqrt(dt);
      fx += Math.cos(buf[o + S_WANDER]) * mo.wanderAmp;
      fy += Math.sin(buf[o + S_WANDER]) * mo.wanderAmp;

      // --- schooling: separation dominates, overlap is more visible than drift
      if (mo.social > 0) {
        let sx = 0, sy = 0, ax = 0, ay = 0, cx = 0, cy = 0, ns = 0, nn = 0;
        for (let k = 0; k < n; k++) {
          if (k === i || specs[k] !== spec) continue;
          const p = k * STRIDE;
          const dx = buf[p + S_X] - x;
          const dy = buf[p + S_Y] - y;
          const d2 = dx * dx + dy * dy;
          if (d2 > 1e-6 && d2 < SEP_R * SEP_R) {
            const d = Math.sqrt(d2);
            sx -= dx / d; sy -= dy / d; ns++;
          }
          if (d2 < NBR_R * NBR_R) {
            ax += Math.cos(buf[p + S_HEADING]);
            ay += Math.sin(buf[p + S_HEADING]);
            cx += buf[p + S_X]; cy += buf[p + S_Y]; nn++;
          }
        }
        if (ns > 0) { fx += (sx / ns) * 2.0 * mo.social; fy += (sy / ns) * 2.0 * mo.social; }
        if (nn > 0) {
          fx += (ax / nn) * 1.0 * mo.social; fy += (ay / nn) * 1.0 * mo.social;
          const dcx = cx / nn - x, dcy = cy / nn - y;
          const dc = Math.sqrt(dcx * dcx + dcy * dcy) || 1;
          fx += (dcx / dc) * 0.6 * mo.social; fy += (dcy / dc) * 0.6 * mo.social;
        }
      }

      // --- walls: turn early and smoothly. Cubic ramp is gentle at the edge of
      // the margin and firm at the glass, so fish never bounce.
      const top = insets.top;
      const bot = height - insets.bottom;
      let wx = 0, wy = 0;
      if (x < margin) wx += (margin - x) / margin;
      if (x > width - margin) wx -= (x - (width - margin)) / margin;
      if (y < top + margin) wy += (top + margin - y) / margin;
      if (y > bot - margin) wy -= (y - (bot - margin)) / margin;
      const m = Math.sqrt(wx * wx + wy * wy);
      if (m > 0) {
        fx += (wx / m) * m * m * m * WALL_GAIN;
        fy += (wy / m) * m * m * m * WALL_GAIN;
        // Also pull the wander target away, or the fish re-aims into the glass
        // every frame and grinds along it.
        buf[o + S_WANDER] += shortestAngle(Math.atan2(wy, wx) - buf[o + S_WANDER]) * Math.min(1, m * m) * 3 * dt;
      }

      // --- depth band: this is what makes a mixed tank read as a community
      if (mo.band !== undefined) {
        fy += clamp((top + mo.band * (bot - top) - y) / 120, -1, 1) * 1.4;
      }

      // --- idle: solitary and deep-bodied fish spend a lot of time hanging in
      // the water rather than cruising. Without this they patrol like drones,
      // which is the difference between "simulated" and "alive".
      let idling = false;
      if (mo.social < 0.5) {
        const idle = buf[o + S_IDLE];
        if (idle > 0) {
          buf[o + S_IDLE] = idle - dt;
          if (buf[o + S_IDLE] <= 0) buf[o + S_IDLE] = -(6 + Math.random() * 8);
          idling = true;
        } else {
          buf[o + S_IDLE] = idle + dt;
          if (buf[o + S_IDLE] >= 0) buf[o + S_IDLE] = 2 + Math.random() * 3;
        }
      }
      // Tail amplitude eases rather than snapping — a fish settling into a hover
      // winds its tail down over about half a second.
      const wantAmp = idling ? 0.35 : 1;
      buf[o + S_AMP] += (wantAmp - buf[o + S_AMP]) * Math.min(1, 2 * dt);

      // --- feeding: seek a recent tap
      const tp = touch.value;
      if (tp.t >= 0) {
        const dx = tp.x - x, dy = tp.y - y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        if (d < 220) { fx += (dx / d) * 3.0; fy += (dy / d) * 3.0; }
      }

      // --- turn, rate-limited
      const desired = Math.atan2(fy, fx);
      const err = shortestAngle(desired - h);
      const step = clamp(err, -mo.turnRate * dt, mo.turnRate * dt);
      buf[o + S_HEADING] = h + step;
      // Smoothed angular velocity drives how far the body arcs into the turn.
      buf[o + S_TURN] += ((step / dt) * 0.35 - buf[o + S_TURN]) * Math.min(1, 6 * dt);

      // --- burst and coast
      buf[o + S_BURST] -= dt;
      if (buf[o + S_BURST] <= 0) {
        buf[o + S_BURST] = mo.burstEvery[0] + Math.random() * (mo.burstEvery[1] - mo.burstEvery[0]);
        buf[o + S_SPEED] = cruise * (1.5 + Math.random() * 0.7);
      }
      const target = cruise
        * (1 - Math.min(0.55, Math.abs(err) * 0.5))
        * (tp.t >= 0 ? 1.6 : 1)
        * (idling ? 0.18 : 1);
      buf[o + S_SPEED] += (target - buf[o + S_SPEED]) * Math.min(1, mo.drag * dt);

      buf[o + S_X] = x + Math.cos(buf[o + S_HEADING]) * buf[o + S_SPEED] * dt;
      buf[o + S_Y] = y + Math.sin(buf[o + S_HEADING]) * buf[o + S_SPEED] * dt;
      // Safety net. With the constants above this should never fire; if it does,
      // wall avoidance is mistuned rather than the clamp being useful.
      buf[o + S_X] = clamp(buf[o + S_X], 2, width - 2);
      buf[o + S_Y] = clamp(buf[o + S_Y], top + 2, bot - 2);

      // --- tail-beat phase follows SPEED, not wall-clock time. Integrating the
      // phase (rather than computing sin(w*t)) avoids a visible snap when the
      // fish accelerates.
      const ratio = clamp(buf[o + S_SPEED] / cruise, 0.35, 2.5);
      buf[o + S_PHASE] = (buf[o + S_PHASE] + TWO_PI * spec.tailBeat * mem.beat * ratio * dt) % TWO_PI;
    }

    frame.value = frame.value + 1;
  });

  return { state, frame, time, touch, members, specs };
}

/** Feed at a point; fish within ~220px will seek it for `seconds`. */
export function feedAt(
  touch: SharedValue<{ x: number; y: number; t: number }>,
  x: number,
  y: number,
  seconds = 6
) {
  touch.value = { x, y, t: seconds };
  setTimeout(() => { touch.value = { x: -1, y: -1, t: -1 }; }, seconds * 1000);
}
