import { Group, Path, Skia, useClock, vec, type SkPath } from "@shopify/react-native-skia";
import { useMemo } from "react";
import { useDerivedValue, type SharedValue } from "react-native-reanimated";

import { sandHeightFor } from "@/shared/constants/tank";

interface Props {
  width: number;
  height: number;
}

const PLANT_COLORS = ["#2e7d57", "#256b4a", "#35906a"];

export function Plants({ width, height }: Props) {
  const clock = useClock();
  const plants = useMemo(() => {
    const baseY = height - sandHeightFor(height) * 0.55;
    // Scale plant height down on short (landscape) canvases so a 150px plant
    // doesn't cover half the tank.
    const k = Math.min(1, height / 640);
    return [
      { x: width * 0.12, h: 120 * k, blades: 3 },
      { x: width * 0.82, h: 150 * k, blades: 4 },
      { x: width * 0.68, h: 80 * k, blades: 3 },
    ].map((p, i) => ({
      ...p,
      baseY,
      phase: i * 1.7,
      paths: Array.from({ length: p.blades }, (_, b) => {
        const spread = (b - (p.blades - 1) / 2) * 9;
        const h = p.h * (0.7 + 0.3 * Math.abs(Math.sin(b * 2.4 + i)));
        const path = Skia.Path.MakeFromSVGString(
          `M ${spread * 0.4} 0 Q ${spread - 6} ${-h * 0.55} ${spread + 3} ${-h}`,
        );
        return { path, color: PLANT_COLORS[(b + i) % PLANT_COLORS.length] };
      }).filter(
        (blade): blade is { path: NonNullable<typeof blade.path>; color: string } =>
          blade.path !== null,
      ),
    }));
  }, [width, height]);

  return (
    <>
      {plants.map((plant, i) => (
        <SwayingPlant key={i} clock={clock} plant={plant} />
      ))}
    </>
  );
}

function SwayingPlant({
  clock,
  plant,
}: {
  clock: SharedValue<number>;
  plant: {
    x: number;
    baseY: number;
    phase: number;
    paths: { path: SkPath; color: string }[];
  };
}) {
  const transform = useDerivedValue(() => [
    { translateX: plant.x },
    { translateY: plant.baseY },
    { skewX: Math.sin(clock.value / 1400 + plant.phase) * 0.09 },
  ]);

  return (
    <Group transform={transform} origin={vec(0, 0)}>
      {plant.paths.map((blade, i) => (
        <Path
          key={i}
          path={blade.path}
          color={blade.color}
          style="stroke"
          strokeWidth={5}
          strokeCap="round"
          opacity={0.9}
        />
      ))}
    </Group>
  );
}
