import {
  Circle,
  ColorMatrix,
  Group,
  Image as SkiaImage,
  Paint,
  Path,
  Picture,
  Skia,
  useClock,
  useImage,
  vec,
  type SkImage,
  type SkPath,
  type SkPicture,
  type Transforms3d,
} from "@shopify/react-native-skia";
import { useMemo } from "react";
import { useDerivedValue, type SharedValue } from "react-native-reanimated";

import { SAND_HEIGHT } from "@/shared/constants/tank";
import { getColorDef } from "@/shared/fish/catalog";
import {
  bodyHalfHeightFor,
  buildFishSpec,
  DEAD_GRAYSCALE_MATRIX,
  DEAD_OPACITY,
  eggSilhouetteSpec,
  eggSpec,
  SILHOUETTE_COLOR,
  STAGE_SQUISH,
  type Box,
  type Primitive,
} from "@/shared/fish/render-spec";
import type { FishTraits, LifeStage } from "@/shared/fish/types";
import { useFishWander, type WanderBox } from "@/shared/hooks/use-fish-wander";
import { spriteFor } from "@/shared/lib/sprites";

import { getBakedFish, type BakedFish } from "./fish-picture";

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
          <Paint opacity={DEAD_OPACITY}>
            <ColorMatrix matrix={DEAD_GRAYSCALE_MATRIX} />
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
  /** Present only for `kind: "group"`. */
  children?: CompiledPrimitive[];
}

/**
 * One SkPath per unique clip `d`. Primitives share the body silhouette string
 * by reference, so a fish with 30 body-clipped shapes compiles one path.
 */
type ClipCache = Map<string, SkPath>;

function compilePrimitive(prim: Primitive, clips: ClipCache): CompiledPrimitive {
  if (prim.clip && !clips.has(prim.clip)) {
    const p = Skia.Path.MakeFromSVGString(prim.clip);
    if (p) clips.set(prim.clip, p);
  }
  if (prim.kind === "group") {
    return { prim, path: null, children: prim.children.map((c) => compilePrimitive(c, clips)) };
  }
  return {
    prim,
    path: prim.kind === "path" ? Skia.Path.MakeFromSVGString(prim.d) : null,
  };
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
    const clips: ClipCache = new Map();
    return {
      spec,
      clips,
      tail: spec.tail.map((p) => compilePrimitive(p, clips)),
      body: spec.body.map((p) => compilePrimitive(p, clips)),
      silhouettePaths: spec.silhouetteDs
        .map((d) => Skia.Path.MakeFromSVGString(d))
        .filter((p): p is SkPath => p !== null),
    };
  }, [traits]);

  // The flattened bake. Every fish of the same traits+stage shares one, so this
  // is a module-level cache lookup, not per-instance work.
  const baked = useMemo(
    () => (stage === "egg" || silhouette ? null : getBakedFish(traits, stage)),
    [traits, stage, silhouette],
  );

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

  // Baked path: two draws per fish instead of ~84 nodes, with every blur and
  // offscreen layer already resolved. The stage squish is baked in, so this
  // branch deliberately does NOT wrap in the squish Group below.
  if (baked) {
    const { bounds } = baked;
    return (
      <>
        <Group transform={tailTransform} origin={vec(baked.tailPivot.x, baked.tailPivot.y)}>
          <BakedLayer art={baked.tail} kind={baked.kind} bounds={bounds} />
        </Group>
        <BakedLayer art={baked.body} kind={baked.kind} bounds={bounds} />
      </>
    );
  }

  return (
    <Group transform={[{ scaleY: squish }]}>
      <Group
        transform={tailTransform}
        origin={vec(compiled.spec.tailPivot.x, compiled.spec.tailPivot.y)}
      >
        {compiled.tail.map((c, i) => (
          <PrimitiveNode key={i} compiled={c} clips={compiled.clips} />
        ))}
      </Group>
      {compiled.body.map((c, i) => (
        <PrimitiveNode key={i} compiled={c} clips={compiled.clips} />
      ))}
    </Group>
  );
}

/** One baked half of a fish — a texture blit, or a recorded command replay. */
function BakedLayer({
  art,
  kind,
  bounds,
}: {
  art: BakedFish["body"];
  kind: BakedFish["kind"];
  bounds: Box;
}) {
  if (kind === "picture") return <Picture picture={art as SkPicture} />;
  return (
    <SkiaImage
      image={art as SkImage}
      x={bounds.x}
      y={bounds.y}
      width={bounds.width}
      height={bounds.height}
      fit="fill"
    />
  );
}

function assertNever(x: never): never {
  throw new Error(`fish-sprite: unhandled IR case ${JSON.stringify(x)}`);
}

/**
 * One IR primitive as Skia nodes. `clip` is applied here rather than by
 * callers so the tree structure matches the SVG emitter one-for-one.
 */
function PrimitiveNode({ compiled, clips }: { compiled: CompiledPrimitive; clips: ClipCache }) {
  const { prim } = compiled;

  if (prim.kind === "group") {
    return (
      <Group clip={prim.clip ? clips.get(prim.clip) : undefined} opacity={prim.opacity ?? 1}>
        {compiled.children!.map((c, i) => (
          <PrimitiveNode key={i} compiled={c} clips={clips} />
        ))}
      </Group>
    );
  }

  const opacity = prim.paint.opacity ?? 1;

  let node: React.JSX.Element | null = null;
  if (prim.kind === "circle") {
    node = (
      <Circle
        cx={prim.cx}
        cy={prim.cy}
        r={prim.r}
        color={prim.paint.color}
        opacity={opacity}
        style={prim.stroke ? "stroke" : "fill"}
        strokeWidth={prim.stroke?.width}
      />
    );
  } else if (prim.kind === "path") {
    if (!compiled.path) return null;
    node = (
      <Path
        path={compiled.path}
        color={prim.paint.color}
        opacity={opacity}
        style={prim.stroke ? "stroke" : "fill"}
        strokeWidth={prim.stroke?.width}
        strokeCap="round"
        strokeJoin="round"
      />
    );
  } else {
    return assertNever(prim);
  }

  const clip = prim.clip ? clips.get(prim.clip) : undefined;
  return clip ? <Group clip={clip}>{node}</Group> : node;
}

function EggBody({ silhouette }: { silhouette?: boolean }) {
  const prims = silhouette ? eggSilhouetteSpec() : eggSpec();
  const clips: ClipCache = new Map();
  return (
    <>
      {prims.map((prim, i) => (
        <PrimitiveNode key={i} compiled={compilePrimitive(prim, clips)} clips={clips} />
      ))}
    </>
  );
}
