import {
  Circle,
  ColorMatrix,
  Group,
  Image as SkiaImage,
  LinearGradient,
  Paint,
  Path,
  Skia,
  useClock,
  useImage,
  vec,
  type SkPath,
  type Transforms3d,
} from "@shopify/react-native-skia";
import { useMemo } from "react";
import { useDerivedValue, type SharedValue } from "react-native-reanimated";

import { SAND_HEIGHT } from "@/shared/constants/tank";
import { getColorDef } from "@/shared/fish/catalog";
import {
  bodyHalfHeightFor,
  buildFishSpec,
  STAGE_SQUISH,
  type Paint as SpecPaint,
  type Primitive,
} from "@/shared/fish/render-spec";
import type { FishTraits, LifeStage } from "@/shared/fish/types";
import { useFishWander, type WanderBox } from "@/shared/hooks/use-fish-wander";
import { spriteFor } from "@/shared/lib/sprites";

const GRAYSCALE_MATRIX = [
  0.3, 0.55, 0.15, 0, 0.02, 0.3, 0.55, 0.15, 0, 0.02, 0.3, 0.55, 0.15, 0, 0.02, 0, 0, 0, 1, 0,
];

const SILHOUETTE_COLOR = "#0a1b29";

interface FishSpriteProps {
  traits: FishTraits;
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

/** One fish in the tank: sprite image when registered, render-spec otherwise. */
export function FishSprite({
  traits,
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
    const deadX = 70 + ((seed * 9973) % 1) * Math.max(1, bounds.width - 140);
    const deadY = bounds.height - SAND_HEIGHT * 0.4 - bodyHalfHeightFor(traits.body) * scale;
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
        <FishBody traits={traits} stage={stage} clock={null} phase={phase} />
      </Group>
    );
  }

  return (
    <Group transform={liveTransform}>
      <FishBody traits={traits} stage={stage} clock={clock} phase={phase} />
    </Group>
  );
}

interface FishBodyProps {
  traits: FishTraits;
  stage: LifeStage;
  /** null = no animation (dead fish, previews). */
  clock: SharedValue<number> | null;
  phase: number;
  /** Draw as a flat dark silhouette (locked fishdex entries). */
  silhouette?: boolean;
}

interface CompiledPrimitive {
  prim: Primitive;
  path: SkPath | null;
}

/**
 * The fish itself in local space (origin at body center, nose left).
 * Renders the registered sprite image when one exists, else the shared
 * render-spec — the exact drawing the HTML preview gallery shows.
 */
export function FishBody({ traits, stage, clock, phase, silhouette }: FishBodyProps) {
  const asset = spriteFor(traits.color, stage);
  const image = useImage(asset);

  const compiled = useMemo(() => {
    const spec = buildFishSpec(traits, getColorDef(traits.color));
    const toCompiled = (prim: Primitive): CompiledPrimitive => ({
      prim,
      path: prim.kind === "path" ? Skia.Path.MakeFromSVGString(prim.d) : null,
    });
    return {
      spec,
      bodyClip: Skia.Path.MakeFromSVGString(spec.bodyPathD),
      tail: spec.tail.map(toCompiled),
      body: spec.body.map(toCompiled),
      silhouettePaths: spec.silhouetteDs
        .map((d) => Skia.Path.MakeFromSVGString(d))
        .filter((p): p is SkPath => p !== null),
    };
  }, [traits]);

  const tailTransform = useDerivedValue<Transforms3d>(() => {
    const t = clock ? clock.value : 0;
    return [{ rotate: clock ? Math.sin(t / 190 + phase) * 0.22 : 0 }];
  });

  if (stage === "egg") {
    return <EggBody silhouette={silhouette} />;
  }

  const squish = STAGE_SQUISH[stage];

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

  if (silhouette) {
    return (
      <Group transform={[{ scaleY: squish }]}>
        {compiled.silhouettePaths.map((path, i) => (
          <Path key={i} path={path} color={SILHOUETTE_COLOR} />
        ))}
      </Group>
    );
  }

  return (
    <Group transform={[{ scaleY: squish }]}>
      <Group
        transform={tailTransform}
        origin={vec(compiled.spec.tailPivot.x, compiled.spec.tailPivot.y)}
      >
        {compiled.tail.map((c, i) => (
          <PrimitiveNode key={i} compiled={c} bodyClip={compiled.bodyClip} />
        ))}
      </Group>
      {compiled.body.map((c, i) => (
        <PrimitiveNode key={i} compiled={c} bodyClip={compiled.bodyClip} />
      ))}
    </Group>
  );
}

function gradientChild(paint: SpecPaint) {
  if (paint.type !== "linear") return null;
  return (
    <LinearGradient
      start={vec(paint.from.x, paint.from.y)}
      end={vec(paint.to.x, paint.to.y)}
      colors={paint.stops.map((s) => s.color)}
      positions={paint.stops.map((s) => s.offset)}
    />
  );
}

function PrimitiveNode({
  compiled,
  bodyClip,
}: {
  compiled: CompiledPrimitive;
  bodyClip: SkPath | null;
}) {
  const { prim, path } = compiled;
  const opacity = prim.paint.opacity ?? 1;
  const solidColor = prim.paint.type === "solid" ? prim.paint.color : undefined;

  let node: React.JSX.Element | null = null;
  if (prim.kind === "circle") {
    node = (
      <Circle cx={prim.cx} cy={prim.cy} r={prim.r} color={solidColor} opacity={opacity}>
        {gradientChild(prim.paint)}
      </Circle>
    );
  } else if (path) {
    node = (
      <Path
        path={path}
        color={solidColor}
        opacity={opacity}
        style={prim.stroke ? "stroke" : "fill"}
        strokeWidth={prim.stroke?.width}
        strokeCap="round"
      >
        {gradientChild(prim.paint)}
      </Path>
    );
  }
  if (!node) return null;

  if (prim.kind === "path" && prim.clip === "body" && bodyClip) {
    return <Group clip={bodyClip}>{node}</Group>;
  }
  return node;
}

function EggBody({ silhouette }: { silhouette?: boolean }) {
  if (silhouette) {
    return <Circle cx={0} cy={0} r={12} color={SILHOUETTE_COLOR} />;
  }
  return (
    <>
      <Circle cx={0} cy={0} r={12} color="#f6e3b0" opacity={0.92} />
      <Circle cx={-3.5} cy={-4} r={3.5} color="#fff7e0" opacity={0.9} />
      <Circle cx={2} cy={2} r={4.4} color="#e0a24e" />
    </>
  );
}
