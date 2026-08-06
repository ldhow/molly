import { Group, LinearGradient, Path, Rect, Skia, vec } from "@shopify/react-native-skia";
import { useMemo } from "react";

import { palette } from "@/shared/constants/theme";

import { sandHeightFor } from "@/shared/constants/tank";

interface Props {
  width: number;
  height: number;
}

export function WaterBackground({ width, height }: Props) {
  const rays = useMemo(
    () =>
      [0.18, 0.42, 0.68].flatMap((f, i) => {
        const topX = width * f;
        const w = 46 + i * 22;
        const drift = height * (0.14 + i * 0.06);
        const path = Skia.Path.MakeFromSVGString(
          `M ${topX} -10 L ${topX + w} -10 L ${topX + w + drift} ${height} L ${topX + drift} ${height} Z`,
        );
        return path ? [path] : [];
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
  const sandHeight = sandHeightFor(height);
  const path = useMemo(() => {
    const top = height - sandHeight;
    return Skia.Path.MakeFromSVGString(
      `M 0 ${height} L 0 ${top + sandHeight * 0.35} ` +
        `Q ${width * 0.28} ${top} ${width * 0.55} ${top + sandHeight * 0.3} ` +
        `Q ${width * 0.8} ${top + sandHeight * 0.55} ${width} ${top + sandHeight * 0.2} ` +
        `L ${width} ${height} Z`,
    );
  }, [width, height, sandHeight]);

  if (!path) return null;
  return (
    <Path path={path}>
      <LinearGradient
        start={vec(0, height - sandHeight)}
        end={vec(0, height)}
        colors={[palette.sand, palette.sandShadow]}
      />
    </Path>
  );
}
