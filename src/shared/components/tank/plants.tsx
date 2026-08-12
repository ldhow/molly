import { Group, Path, Skia, useClock, vec, type SkPath } from "@shopify/react-native-skia";
import { useMemo } from "react";
import { useDerivedValue, type SharedValue } from "react-native-reanimated";

import { sandHeightFor } from "@/shared/constants/tank";

interface Props {
  width: number;
  height: number;
}

const GRASS_COLORS = ["#2e7d57", "#256b4a", "#35906a"];
const LEAF_COLORS = ["#1f6b46", "#2f8f5b", "#175c3d"];

interface PlantLayout {
  /** Fraction of canvas width. */
  xFraction: number;
  h: number;
  blades: number;
  kind: "grass" | "leaf";
}

/**
 * Two clusters left and right of the tank, an open lane down the middle for
 * fish to actually swim through — mirrors how Rocks positions its boulders.
 */
const PLANT_LAYOUT: PlantLayout[] = [
  { xFraction: 0.05, h: 130, blades: 4, kind: "grass" },
  { xFraction: 0.14, h: 68, blades: 3, kind: "leaf" },
  { xFraction: 0.62, h: 88, blades: 3, kind: "leaf" },
  { xFraction: 0.8, h: 155, blades: 5, kind: "grass" },
  { xFraction: 0.93, h: 72, blades: 3, kind: "grass" },
];

interface Blade {
  path: SkPath;
  color: string;
  kind: "grass" | "leaf";
  rib?: SkPath;
}

export function Plants({ width, height }: Props) {
  const clock = useClock();
  const plants = useMemo(() => {
    const baseY = height - sandHeightFor(height) * 0.55;
    // Scale plant height down on short (landscape) canvases so a 150px plant
    // doesn't cover half the tank.
    const k = Math.min(1, height / 640);
    return PLANT_LAYOUT.map((p, i) => {
      const h = p.h * k;
      const colors = p.kind === "leaf" ? LEAF_COLORS : GRASS_COLORS;
      const blades: Blade[] = Array.from({ length: p.blades }, (_, b): Blade | null => {
        const spread = (b - (p.blades - 1) / 2) * (p.kind === "leaf" ? 11 : 9);
        const bh = h * (0.7 + 0.3 * Math.abs(Math.sin(b * 2.4 + i)));
        const color = colors[(b + i) % colors.length];
        if (p.kind === "leaf") {
          // A broad tapered leaf: two bulging curves from the base up to a
          // point, wider through the belly than a grass blade — reads as
          // a sword-plant leaf rather than another clump of grass.
          const tipX = spread * 0.4 + 3;
          const bellyW = 4.5 + bh * 0.05;
          const d =
            `M 0 0 Q ${(spread * 0.5 - bellyW).toFixed(1)} ${(-bh * 0.45).toFixed(1)} ${tipX.toFixed(1)} ${(-bh).toFixed(1)} ` +
            `Q ${(spread * 0.5 + bellyW).toFixed(1)} ${(-bh * 0.45).toFixed(1)} 0 0 Z`;
          const path = Skia.Path.MakeFromSVGString(d);
          const rib = Skia.Path.MakeFromSVGString(
            `M 0 0 Q ${(spread * 0.5).toFixed(1)} ${(-bh * 0.45).toFixed(1)} ${tipX.toFixed(1)} ${(-bh).toFixed(1)}`,
          );
          return path ? { path, color, kind: "leaf" as const, rib: rib ?? undefined } : null;
        }
        const path = Skia.Path.MakeFromSVGString(
          `M ${spread * 0.4} 0 Q ${spread - 6} ${-bh * 0.55} ${spread + 3} ${-bh}`,
        );
        return path ? { path, color, kind: "grass" as const } : null;
      }).filter((blade): blade is Blade => blade !== null);
      return { x: width * p.xFraction, baseY, phase: i * 1.7, blades };
    });
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
  plant: { x: number; baseY: number; phase: number; blades: Blade[] };
}) {
  const transform = useDerivedValue(() => [
    { translateX: plant.x },
    { translateY: plant.baseY },
    { skewX: Math.sin(clock.value / 1400 + plant.phase) * 0.09 },
  ]);

  return (
    <Group transform={transform} origin={vec(0, 0)}>
      {plant.blades.map((blade, i) =>
        blade.kind === "leaf" ? (
          <Group key={i}>
            <Path path={blade.path} color={blade.color} opacity={0.92} />
            {blade.rib ? (
              <Path
                path={blade.rib}
                style="stroke"
                strokeWidth={0.8}
                color="#0d3322"
                opacity={0.35}
              />
            ) : null}
          </Group>
        ) : (
          <Path
            key={i}
            path={blade.path}
            color={blade.color}
            style="stroke"
            strokeWidth={5}
            strokeCap="round"
            opacity={0.9}
          />
        ),
      )}
    </Group>
  );
}
