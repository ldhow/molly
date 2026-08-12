import {
  Circle,
  Group,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Skia,
  useClock,
  vec,
} from "@shopify/react-native-skia";
import { useMemo } from "react";
import { useDerivedValue, type SharedValue } from "react-native-reanimated";

import { palette } from "@/shared/constants/theme";

import { sandHeightFor } from "@/shared/constants/tank";
import { makeRng } from "@/shared/lib/rng";

interface Props {
  width: number;
  height: number;
}

/** Top-x fraction of each light shaft, widest/slowest first. */
const RAY_FRACTIONS = [0.12, 0.32, 0.52, 0.74];

export function WaterBackground({ width, height }: Props) {
  const clock = useClock();
  const rays = useMemo(
    () =>
      RAY_FRACTIONS.flatMap((fraction, i) => {
        const topX = width * fraction;
        const w = 34 + i * 16;
        const drift = height * (0.12 + i * 0.05);
        const path = Skia.Path.MakeFromSVGString(
          `M ${topX} -10 L ${topX + w} -10 L ${topX + w + drift} ${height} L ${topX + drift} ${height} Z`,
        );
        // Slow, gentle shimmer — each ray drifts through its own opacity
        // range so the god-rays read as moving water rather than a fixed
        // decal, without a per-frame reflow of the shapes themselves.
        return path ? [{ path, phase: i * 1.7 }] : [];
      }),
    [width, height],
  );

  return (
    <>
      <Rect x={0} y={0} width={width} height={height}>
        <LinearGradient
          start={vec(0, 0)}
          end={vec(0, height)}
          colors={[palette.waterTop, palette.waterMid, palette.waterBottom]}
          positions={[0, 0.45, 1]}
        />
      </Rect>
      <Group>
        {rays.map((ray, i) => (
          <ShimmerRay key={i} clock={clock} path={ray.path} phase={ray.phase} />
        ))}
      </Group>
      {/* Depth vignette: a soft, static radial darkening toward the corners —
          cheap (one rect) but does more for "this is a deep tank" than
          anything animated would. */}
      <Rect x={0} y={0} width={width} height={height}>
        <RadialGradient
          c={vec(width / 2, height * 0.42)}
          r={Math.max(width, height) * 0.78}
          colors={["rgba(0,0,0,0)", "rgba(1,9,16,0.34)"]}
          positions={[0.55, 1]}
        />
      </Rect>
    </>
  );
}

function ShimmerRay({
  clock,
  path,
  phase,
}: {
  clock: SharedValue<number>;
  path: ReturnType<typeof Skia.Path.MakeFromSVGString>;
  phase: number;
}) {
  const opacity = useDerivedValue(
    () => 0.028 + 0.026 * (0.5 + 0.5 * Math.sin(clock.value / 2600 + phase)),
  );
  if (!path) return null;
  return <Path path={path} color="#bfe6ff" opacity={opacity} />;
}

export function Sand({ width, height }: Props) {
  const sandHeight = sandHeightFor(height);
  const top = height - sandHeight;

  const path = useMemo(
    () =>
      Skia.Path.MakeFromSVGString(
        `M 0 ${height} L 0 ${top + sandHeight * 0.35} ` +
          `Q ${width * 0.28} ${top} ${width * 0.55} ${top + sandHeight * 0.3} ` +
          `Q ${width * 0.8} ${top + sandHeight * 0.55} ${width} ${top + sandHeight * 0.2} ` +
          `L ${width} ${height} Z`,
      ),
    [width, height, sandHeight, top],
  );

  // Small pebbles scattered across the band. Deterministic per canvas size
  // (not Math.random) so the tank doesn't re-scatter its own floor on every
  // re-render — same convention render-spec.ts uses for fish art.
  const pebbles = useMemo(() => {
    const rng = makeRng(`sand-pebbles-${Math.round(width)}x${Math.round(height)}`);
    const count = Math.max(10, Math.round(width / 40));
    return Array.from({ length: count }, () => ({
      cx: rng() * width,
      // Weighted toward the lower half of the band — pebbles settle low,
      // they don't float up near the sand's own crest.
      cy: top + sandHeight * (0.4 + rng() * 0.55),
      r: 1.5 + rng() * 2.4,
    }));
  }, [width, height, top, sandHeight]);

  if (!path) return null;
  return (
    <>
      <Path path={path}>
        <LinearGradient
          start={vec(0, top)}
          end={vec(0, height)}
          colors={[palette.sand, palette.sandShadow]}
        />
      </Path>
      <Group clip={path}>
        {pebbles.map((p, i) => (
          <Group key={i}>
            <Circle
              cx={p.cx}
              cy={p.cy + p.r * 0.35}
              r={p.r}
              color={palette.sandShadow}
              opacity={0.4}
            />
            <Circle
              cx={p.cx - p.r * 0.3}
              cy={p.cy - p.r * 0.3}
              r={p.r * 0.42}
              color="#f2e6c8"
              opacity={0.45}
            />
          </Group>
        ))}
      </Group>
    </>
  );
}

const ROCK_A_D =
  "M -24 8 Q -28 -6 -15 -13 Q 1 -21 17 -10 Q 27 -3 21 8 Q 11 15 -4 14 Q -17 14 -24 8 Z";
const ROCK_B_D = "M -15 6 Q -18 -4 -8 -9 Q 4 -13 13 -4 Q 16 2 9 7 Q -2 12 -15 6 Z";

interface RockConfig {
  x: number;
  y: number;
  scale: number;
  d: string;
  tone: [string, string];
}

/** A couple of smooth boulders anchoring the sand — hardscape, not fish. */
export function Rocks({ width, height }: Props) {
  const sandHeight = sandHeightFor(height);
  const baseY = height - sandHeight * 0.7;
  const k = Math.min(1, height / 640);

  const rocks = useMemo<RockConfig[]>(
    () => [
      { x: width * 0.09, y: baseY, scale: 1.55 * k, d: ROCK_A_D, tone: ["#63757f", "#232e35"] },
      { x: width * 0.17, y: baseY + 4, scale: 0.85 * k, d: ROCK_B_D, tone: ["#526572", "#1f2930"] },
      { x: width * 0.91, y: baseY, scale: 1.15 * k, d: ROCK_B_D, tone: ["#5c6f79", "#212b32"] },
    ],
    [width, baseY, k],
  );

  const compiled = useMemo(
    () => rocks.map((r) => ({ ...r, path: Skia.Path.MakeFromSVGString(r.d) })),
    [rocks],
  );

  return (
    <>
      {compiled.map((r, i) =>
        r.path ? (
          <Group key={i} transform={[{ translateX: r.x }, { translateY: r.y }, { scale: r.scale }]}>
            <Circle cx={0} cy={14} r={17} color="#01070c" opacity={0.2} />
            <Path path={r.path}>
              <LinearGradient start={vec(-20, -18)} end={vec(18, 14)} colors={r.tone} />
            </Path>
            {/* A short catch-light arc along the top-left edge, where the
                overhead light would graze a wet rock. */}
            <Path
              path={r.path}
              style="stroke"
              strokeWidth={1.6}
              color="#aec2cb"
              opacity={0.28}
              start={0}
              end={0.4}
            />
          </Group>
        ) : null,
      )}
    </>
  );
}
