import {
  Circle,
  ColorMatrix,
  Group,
  Image as SkiaImage,
  LinearGradient,
  Oval,
  Paint,
  Path,
  useClock,
  useImage,
  vec,
  type Transforms3d,
} from "@shopify/react-native-skia";
import { useDerivedValue, type SharedValue } from "react-native-reanimated";

import type { FishVariant, LifeStage } from "@/shared/fish/types";

import { SAND_HEIGHT } from "@/shared/constants/tank";
import { useFishWander, type WanderBox } from "@/shared/hooks/use-fish-wander";
import { fishGeometryFor } from "@/shared/lib/fish-geometry";
import { spriteFor } from "@/shared/lib/sprites";

const GRAYSCALE_MATRIX = [
  0.3, 0.55, 0.15, 0, 0.02, 0.3, 0.55, 0.15, 0, 0.02, 0.3, 0.55, 0.15, 0, 0.02, 0, 0, 0, 1, 0,
];

interface FishSpriteProps {
  variant: FishVariant;
  stage: LifeStage;
  status: "alive" | "dead";
  bounds: { width: number; height: number };
  /** Final render scale (life stage × any session growth). */
  scale: number;
  /** Stable per-fish value in [0,1). */
  seed: number;
  /** "center": session mode — slow drift near the middle of the tank. */
  mode?: "tank" | "center";
}

/** One fish in the tank: sprite image when registered, vector fallback otherwise. */
export function FishSprite({
  variant,
  stage,
  status,
  bounds,
  scale,
  seed,
  mode = "tank",
}: FishSpriteProps) {
  const clock = useClock();
  const phase = seed * Math.PI * 2;
  const dead = status === "dead";

  const box: WanderBox =
    mode === "center"
      ? {
          minX: bounds.width * 0.3,
          maxX: bounds.width * 0.7,
          minY: bounds.height * 0.3,
          maxY: bounds.height * 0.62,
        }
      : {
          minX: 60,
          maxX: Math.max(61, bounds.width - 60),
          minY: 50,
          maxY: Math.max(51, bounds.height - SAND_HEIGHT - 40),
        };

  const wander = useFishWander({
    box,
    seed,
    speedFactor: mode === "center" ? 0.45 : 1,
    enabled: !dead,
  });

  const liveTransform = useDerivedValue<Transforms3d>(() => {
    const t = clock.value;
    const bob = Math.sin(t / 900 + phase) * 3;
    const stroke = 1 - 0.035 * Math.abs(Math.sin(t / 280 + phase));
    return [
      { translateX: wander.x.value },
      { translateY: wander.y.value + bob },
      { rotate: wander.tilt.value },
      { scaleX: wander.heading.value * scale * stroke },
      { scaleY: scale },
    ];
  });

  if (dead) {
    // Belly-up on the sand, drained of color — the reminder.
    const geometry = fishGeometryFor(variant);
    const deadX = 70 + ((seed * 9973) % 1) * Math.max(1, bounds.width - 140);
    const deadY = bounds.height - SAND_HEIGHT * 0.4 - geometry.bodyHalfHeight * scale;
    const deadTransform: Transforms3d = [
      { translateX: deadX },
      { translateY: deadY },
      { rotate: (seed - 0.5) * 0.24 },
      { scaleX: seed > 0.5 ? scale : -scale },
      { scaleY: -scale },
    ];
    return (
      <Group
        transform={deadTransform}
        layer={
          <Paint opacity={0.6}>
            <ColorMatrix matrix={GRAYSCALE_MATRIX} />
          </Paint>
        }
      >
        <FishBody variant={variant} stage={stage} clock={null} phase={phase} />
      </Group>
    );
  }

  return (
    <Group transform={liveTransform}>
      <FishBody variant={variant} stage={stage} clock={clock} phase={phase} />
    </Group>
  );
}

interface FishBodyProps {
  variant: FishVariant;
  stage: LifeStage;
  /** null = no animation (dead fish, previews). */
  clock: SharedValue<number> | null;
  phase: number;
  /** Draw as a flat dark silhouette (locked fishdex entries). */
  silhouette?: boolean;
}

/**
 * The fish itself in local space (origin at body center, nose left).
 * Renders the registered sprite image when one exists, else vector paths.
 */
export function FishBody({ variant, stage, clock, phase, silhouette }: FishBodyProps) {
  const asset = spriteFor(variant.id, stage);
  const image = useImage(asset);

  const tailTransform = useDerivedValue<Transforms3d>(() => {
    const t = clock ? clock.value : 0;
    return [{ rotate: clock ? Math.sin(t / 190 + phase) * 0.22 : 0 }];
  });

  if (stage === "egg") {
    return <EggBody silhouette={silhouette} />;
  }

  if (asset != null && image) {
    const w = 110;
    const h = 70;
    return (
      <Group
        layer={
          silhouette ? (
            <Paint>
              <ColorMatrix
                matrix={[0, 0, 0, 0, 0.04, 0, 0, 0, 0, 0.1, 0, 0, 0, 0, 0.16, 0, 0, 0, 1, 0]}
              />
            </Paint>
          ) : undefined
        }
      >
        <SkiaImage image={image} x={-w / 2} y={-h / 2} width={w} height={h} fit="contain" />
      </Group>
    );
  }

  const geometry = fishGeometryFor(variant);
  const { colors } = variant;
  const bodyColor = silhouette ? "#0a1b29" : colors.body;
  const bellyColor = silhouette ? "#0a1b29" : colors.belly;
  const finColor = silhouette ? "#0a1b29" : colors.fin;

  // Fry are slimmer than a scaled-down adult.
  const stageSquish = stage === "fry" ? 0.72 : stage === "juvenile" ? 0.88 : 1;

  return (
    <Group transform={[{ scaleY: stageSquish }]}>
      <Group transform={tailTransform} origin={vec(geometry.tailPivot.x, geometry.tailPivot.y)}>
        <Path path={geometry.tail} color={finColor} opacity={0.92} />
      </Group>
      <Path path={geometry.dorsal} color={finColor} opacity={0.92} />
      <Path path={geometry.pelvic} color={finColor} opacity={0.9} />
      <Path path={geometry.body}>
        <LinearGradient
          start={vec(0, -geometry.bodyHalfHeight)}
          end={vec(0, geometry.bodyHalfHeight)}
          colors={[bodyColor, bodyColor, bellyColor]}
          positions={[0, 0.55, 1]}
        />
      </Path>
      {!silhouette && variant.colors.spots ? (
        <Group clip={geometry.body}>
          {geometry.spots.map((s, i) => (
            <Oval
              key={i}
              x={s.cx - s.rx}
              y={s.cy - s.ry}
              width={s.rx * 2}
              height={s.ry * 2}
              color={variant.colors.spots}
              opacity={0.85}
            />
          ))}
        </Group>
      ) : null}
      {!silhouette ? (
        <>
          <Circle cx={geometry.eye.cx} cy={geometry.eye.cy} r={geometry.eye.r} color="#10131a" />
          <Circle cx={geometry.eye.cx + 1.1} cy={geometry.eye.cy - 1.1} r={1.1} color="#e8f2fa" />
        </>
      ) : null}
    </Group>
  );
}

function EggBody({ silhouette }: { silhouette?: boolean }) {
  if (silhouette) {
    return <Circle cx={0} cy={0} r={12} color="#0a1b29" />;
  }
  return (
    <>
      <Circle cx={0} cy={0} r={12} color="#f6e3b0" opacity={0.92} />
      <Circle cx={-3.5} cy={-4} r={3.5} color="#fff7e0" opacity={0.9} />
      <Circle cx={2} cy={2} r={4.4} color="#e0a24e" />
    </>
  );
}
