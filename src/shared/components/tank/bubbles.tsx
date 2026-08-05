import { Circle, useClock } from "@shopify/react-native-skia";
import { useMemo } from "react";
import { useDerivedValue, type SharedValue } from "react-native-reanimated";

import { BUBBLE_COUNT } from "@/shared/constants/tank";

interface Props {
  width: number;
  height: number;
}

interface BubbleConfig {
  xFraction: number;
  radius: number;
  /** px per second upward. */
  speed: number;
  phase: number;
}

export function Bubbles({ width, height }: Props) {
  const clock = useClock();
  const configs = useMemo<BubbleConfig[]>(
    () =>
      Array.from({ length: BUBBLE_COUNT }, (_, i) => {
        const f = i / BUBBLE_COUNT;
        return {
          xFraction: (f * 0.83 + 0.07 + ((i * 0.37) % 0.1)) % 1,
          radius: 1.6 + ((i * 1.7) % 3),
          speed: 26 + ((i * 13) % 30),
          phase: (i * 0.41) % 1,
        };
      }),
    [],
  );

  return (
    <>
      {configs.map((cfg, i) => (
        <Bubble key={i} clock={clock} cfg={cfg} width={width} height={height} />
      ))}
    </>
  );
}

function Bubble({
  clock,
  cfg,
  width,
  height,
}: {
  clock: SharedValue<number>;
  cfg: BubbleConfig;
  width: number;
  height: number;
}) {
  const cy = useDerivedValue(() => {
    const travel = height + 30;
    return height + 15 - (((clock.value / 1000) * cfg.speed + cfg.phase * travel) % travel);
  });
  const cx = useDerivedValue(
    () => cfg.xFraction * width + Math.sin(clock.value / 800 + cfg.phase * 9) * 5,
  );

  return <Circle cx={cx} cy={cy} r={cfg.radius} color="#bfe6ff" opacity={0.32} />;
}
