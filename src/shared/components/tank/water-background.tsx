import { Group, LinearGradient, Path, Rect, Skia, vec } from "@shopify/react-native-skia";
import { useMemo } from "react";

import { palette } from "@/shared/constants/theme";

import { SAND_HEIGHT } from "@/shared/constants/tank";

interface Props {
  width: number;
  height: number;
}

export function WaterBackground({ width, height }: Props) {
  const rays = useMemo(
    () =>
      [0.18, 0.42, 0.68].map((f, i) => {
        const path = Skia.Path.Make();
        const topX = width * f;
        const w = 46 + i * 22;
        const drift = 90 + i * 40;
        path.moveTo(topX, -10);
        path.lineTo(topX + w, -10);
        path.lineTo(topX + w + drift, height);
        path.lineTo(topX + drift, height);
        path.close();
        return path;
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
          <Path key={i} path={ray} color="#bfe6ff" opacity={0.045} />
        ))}
      </Group>
    </>
  );
}

export function Sand({ width, height }: Props) {
  const path = useMemo(() => {
    const p = Skia.Path.Make();
    const top = height - SAND_HEIGHT;
    p.moveTo(0, height);
    p.lineTo(0, top + SAND_HEIGHT * 0.35);
    p.quadTo(width * 0.28, top, width * 0.55, top + SAND_HEIGHT * 0.3);
    p.quadTo(width * 0.8, top + SAND_HEIGHT * 0.55, width, top + SAND_HEIGHT * 0.2);
    p.lineTo(width, height);
    p.close();
    return p;
  }, [width, height]);

  return (
    <Path path={path}>
      <LinearGradient
        start={vec(0, height - SAND_HEIGHT)}
        end={vec(0, height)}
        colors={[palette.sand, palette.sandShadow]}
      />
    </Path>
  );
}
