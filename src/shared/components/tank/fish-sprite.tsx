import {
  Blur,
  BlurMask,
  Circle,
  ColorMatrix,
  Group,
  Image as SkiaImage,
  LinearGradient,
  Paint,
  Path,
  Picture,
  RadialGradient,
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

import { sandHeightFor } from "@/shared/constants/tank";
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
  type Blend,
  type Paint as SpecPaint,
  type Primitive,
} from "@/shared/fish/render-spec";
import type { FishTraits, LifeStage } from "@/shared/fish/types";
import { useFishSwim, type WanderBox } from "@/shared/hooks/use-fish-swim";
import { spriteFor } from "@/shared/lib/sprites";
import { waveDy } from "@/shared/lib/swim-model";

import { getBakedFish, type BakedFish, type BakedLayer as BakedLayerArt } from "./fish-picture";
import { UndulatingBody } from "./undulating-body";

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

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
  /**
   * [0,1) "how far back" this fish sits — tank mode only. Nearer (1) fish
   * render bigger and fully opaque; farther (0) fish shrink, fog slightly,
   * and sit a touch higher, so the tank reads as a volume instead of a flat
   * row of sprites.
   */
  depth?: number;
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
  depth,
}: FishSpriteProps) {
  const clock = useClock();
  const phase = seed * Math.PI * 2;
  const dead = status === "dead";
  const hasDepth = mode === "tank" && depth !== undefined;

  // Tank-mode margins as fractions of the canvas so they hold up in landscape
  // (fixed pixel insets used to collapse the swimmable band on a short canvas).
  const insetX = Math.min(48, bounds.width * 0.1);
  const insetTop = Math.min(40, bounds.height * 0.08);
  const insetBottom = Math.min(30, bounds.height * 0.06);

  const box: WanderBox =
    mode === "center"
      ? {
          minX: bounds.width * 0.3,
          maxX: bounds.width * 0.7,
          minY: bounds.height * 0.3,
          maxY: bounds.height * 0.62,
        }
      : {
          minX: insetX,
          maxX: Math.max(insetX + 1, bounds.width - insetX),
          minY: insetTop,
          maxY:
            Math.max(insetTop + 1, bounds.height - sandHeightFor(bounds.height) - insetBottom) -
            (hasDepth ? (1 - depth) * bounds.height * 0.06 : 0),
        };

  const swim = useFishSwim({
    box,
    seed,
    speedFactor: mode === "center" ? 0.45 : 1,
    enabled: !dead,
  });

  const depthScale = hasDepth ? scale * lerp(0.82, 1.08, depth) : scale;
  const depthOpacity = hasDepth ? lerp(0.78, 1, depth) : 1;

  const liveTransform = useDerivedValue<Transforms3d>(() => {
    const t = clock.value;
    const bob = Math.sin(t / 900 + phase) * 3;
    const stroke = 1 - 0.02 * Math.abs(Math.sin(swim.beatPhase.value * 0.5));
    return [
      { translateX: swim.x.value },
      { translateY: swim.y.value + bob },
      { rotate: swim.tilt.value + swim.bank.value },
      { perspective: 550 },
      { rotateY: swim.yaw.value },
      { scaleX: depthScale * stroke },
      { scaleY: depthScale },
    ];
  });

  if (dead) {
    // Belly-up on the sand, drained of color — the reminder.
    const deadX = insetX + ((seed * 9973) % 1) * Math.max(1, bounds.width - insetX * 2);
    const deadY =
      bounds.height - sandHeightFor(bounds.height) * 0.4 - bodyHalfHeightFor(traits.body) * scale;
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
    <Group transform={liveTransform} opacity={depthOpacity}>
      <FishBody
        traits={traits}
        stage={stage}
        clock={clock}
        phase={phase}
        motion={{ beatPhase: swim.beatPhase, speedNorm: swim.speedNorm }}
      />
    </Group>
  );
}

/** Shared values driving beat-coupled animation — absent for static surfaces. */
export interface FishMotion {
  beatPhase: SharedValue<number>;
  speedNorm: SharedValue<number>;
}

interface FishBodyProps {
  traits: FishTraits;
  stage: LifeStage;
  /** null = no animation (dead fish, previews). */
  clock: SharedValue<number> | null;
  phase: number;
  /** Draw as a flat dark silhouette (locked fishdex entries). */
  silhouette?: boolean;
  /**
   * Skip the baked-image cache and always draw the declarative node tree.
   * Baking is cheap per fish but not free — worth it for the handful of fish
   * animating every frame in the live tank, but a gallery/grid mounts many
   * distinct fish at once and would evict the tank's own cached textures
   * baking all of them too. Same art either way.
   */
  vector?: boolean;
  /**
   * Present only for live tank fish: drives the tail's speed-coupled beat and
   * (in "image" bake mode) a traveling body-wave mesh. Absent everywhere else
   * (fishdex, holding tank, focus home, dead fish) — those render the exact
   * rest pose the fish-preview gallery shows.
   */
  motion?: FishMotion;
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
export function FishBody({
  traits,
  stage,
  clock,
  phase,
  silhouette,
  vector,
  motion,
}: FishBodyProps) {
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
      front: spec.front.map((p) => compilePrimitive(p, clips)),
      silhouettePaths: spec.silhouetteDs
        .map((d) => Skia.Path.MakeFromSVGString(d))
        .filter((p): p is SkPath => p !== null),
    };
  }, [traits]);

  // The flattened bake. Every fish of the same traits+stage shares one, so this
  // is a module-level cache lookup, not per-instance work.
  const baked = useMemo(
    () => (stage === "egg" || silhouette || vector ? null : getBakedFish(traits, stage)),
    [traits, stage, silhouette, vector],
  );

  // Normalized head(0)→tail(1) position of the tail pivot within the spec's
  // own bounds — the same coordinate space `waveDy` operates in, so the tail
  // rotation below evaluates the body wave at exactly the point the mesh's
  // rearmost column also evaluates it. Identical inputs, so the seam can't
  // drift apart.
  const tailPivotU = useMemo(
    () => (compiled.spec.tailPivot.x - compiled.spec.bounds.x) / compiled.spec.bounds.width,
    [compiled],
  );

  const tailTransform = useDerivedValue<Transforms3d>(() => {
    if (!clock) return [{ rotate: 0 }];
    if (motion) {
      const dy = waveDy(tailPivotU, motion.beatPhase.value, motion.speedNorm.value, phase);
      const tailAmp = 0.16 + 0.14 * motion.speedNorm.value;
      const rot = tailAmp * Math.sin(motion.beatPhase.value - 4.8 * tailPivotU + phase - 0.4);
      return [{ translateY: dy }, { rotate: rot }];
    }
    const t = clock.value;
    return [{ rotate: Math.sin(t / 190 + phase) * 0.22 }];
  });

  // The pectoral fin sculls harder at a hover than at full speed — the same
  // beat drives it, just inverted against `speedNorm`, so a fish that's
  // barely moving still reads as alive.
  const pectoralTransform = useDerivedValue<Transforms3d>(() => {
    if (!motion) return [{ rotate: 0 }];
    const s = motion.speedNorm.value;
    const rot =
      (0.1 + 0.14 * (1 - Math.min(1, s))) * Math.sin(motion.beatPhase.value * 1.7 + phase + 1.3);
    return [{ rotate: rot }];
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

  // Baked path: three draws per fish instead of ~84 nodes, with every blur
  // and offscreen layer already resolved. The stage squish is baked in, so
  // this branch deliberately does NOT wrap in the squish Group below.
  if (baked) {
    // The undulation mesh only has something to ride when the bake produced
    // an actual texture — "picture" mode gets the rigid body + coupled tail
    // instead, which is still a real liveliness upgrade over the old constant
    // tail metronome.
    const canUndulate = motion && baked.kind === "image";
    return (
      <>
        <Group transform={tailTransform} origin={vec(baked.tailPivot.x, baked.tailPivot.y)}>
          <BakedLayer layer={baked.tail} kind={baked.kind} />
        </Group>
        {canUndulate ? (
          <UndulatingBody
            image={baked.body.art as SkImage}
            bounds={baked.body.bounds}
            beatPhase={motion.beatPhase}
            speedNorm={motion.speedNorm}
            phase={phase}
          />
        ) : (
          <BakedLayer layer={baked.body} kind={baked.kind} />
        )}
        <Group
          transform={pectoralTransform}
          origin={vec(baked.pectoralPivot.x, baked.pectoralPivot.y)}
        >
          <BakedLayer layer={baked.front} kind={baked.kind} />
        </Group>
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
      <Group
        transform={pectoralTransform}
        origin={vec(compiled.spec.pectoralPivot.x, compiled.spec.pectoralPivot.y)}
      >
        {compiled.front.map((c, i) => (
          <PrimitiveNode key={i} compiled={c} clips={compiled.clips} />
        ))}
      </Group>
    </Group>
  );
}

/** One baked fin/body layer — a texture blit, or a recorded command replay. */
function BakedLayer({ layer, kind }: { layer: BakedLayerArt; kind: BakedFish["kind"] }) {
  if (kind === "picture") return <Picture picture={layer.art as SkPicture} />;
  const { bounds } = layer;
  return (
    <SkiaImage
      image={layer.art as SkImage}
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
 * The IR's `Blend` names are deliberately spelled as Skia's own blendMode prop
 * strings, so this is the identity apart from dropping the default. The
 * `switch` (rather than a passthrough) is what actually enforces that
 * correspondence — `assertNever` fails the build if `Blend` ever gains a name
 * Skia's declarative `blendMode` prop doesn't recognise.
 */
function skiaBlend(blend: Blend): Exclude<Blend, "srcOver"> | undefined {
  switch (blend) {
    case "srcOver":
      return undefined;
    case "multiply":
    case "screen":
    case "overlay":
    case "softLight":
    case "plusLighter":
      return blend;
    default:
      return assertNever(blend);
  }
}

function paintChild(paint: SpecPaint) {
  switch (paint.type) {
    case "solid":
      return null;
    case "linear":
      return (
        <LinearGradient
          start={vec(paint.from.x, paint.from.y)}
          end={vec(paint.to.x, paint.to.y)}
          colors={paint.stops.map((s) => s.color)}
          positions={paint.stops.map((s) => s.offset)}
        />
      );
    case "radial": {
      // `scale` gives an elliptical falloff; Skia applies it as a transform
      // about the centre, exactly as SVG's gradientTransform does.
      const s = paint.scale;
      return (
        <RadialGradient
          c={vec(paint.center.x, paint.center.y)}
          r={paint.radius}
          colors={paint.stops.map((st) => st.color)}
          positions={paint.stops.map((st) => st.offset)}
          origin={vec(paint.center.x, paint.center.y)}
          transform={s ? [{ scaleX: s.x }, { scaleY: s.y }] : undefined}
        />
      );
    }
    default:
      return assertNever(paint);
  }
}

/**
 * One IR primitive as Skia nodes. Clip/blur/blend are applied here rather than
 * by callers so the tree structure matches the SVG emitter one-for-one.
 */
function PrimitiveNode({ compiled, clips }: { compiled: CompiledPrimitive; clips: ClipCache }) {
  const { prim } = compiled;

  if (prim.kind === "group") {
    const inner = (
      <>
        {compiled.children!.map((c, i) => (
          <PrimitiveNode key={i} compiled={c} clips={clips} />
        ))}
      </>
    );
    // A group blur is an IMAGE filter — it blurs the composited result, so it
    // needs a layer. `isolate` forces that same layer so children blending
    // against "the backdrop" see the fish, not the tank water behind it.
    const hasBlur = prim.blur !== undefined && prim.blur > 0;
    const needsLayer = prim.isolate || hasBlur || prim.blend !== undefined;
    const layer = needsLayer ? (
      <Paint opacity={prim.opacity ?? 1} blendMode={prim.blend ? skiaBlend(prim.blend) : undefined}>
        {prim.blur !== undefined && prim.blur > 0 ? <Blur blur={prim.blur} /> : null}
      </Paint>
    ) : undefined;
    return (
      <Group clip={prim.clip ? clips.get(prim.clip) : undefined} layer={layer}>
        {needsLayer ? inner : <Group opacity={prim.opacity ?? 1}>{inner}</Group>}
      </Group>
    );
  }

  const opacity = prim.paint.opacity ?? 1;
  const solidColor = prim.paint.type === "solid" ? prim.paint.color : undefined;
  const blendMode = prim.blend ? skiaBlend(prim.blend) : undefined;
  // A primitive blur is a MASK filter: it softens this shape's own alpha in a
  // single draw, with no offscreen allocation.
  const maskBlur =
    prim.blur !== undefined && prim.blur > 0 ? <BlurMask blur={prim.blur} style="normal" /> : null;

  let node: React.JSX.Element | null = null;
  if (prim.kind === "circle") {
    node = (
      <Circle
        cx={prim.cx}
        cy={prim.cy}
        r={prim.r}
        color={solidColor}
        opacity={opacity}
        blendMode={blendMode}
      >
        {paintChild(prim.paint)}
        {maskBlur}
      </Circle>
    );
  } else if (prim.kind === "path") {
    if (!compiled.path) return null;
    node = (
      <Path
        path={compiled.path}
        color={solidColor}
        opacity={opacity}
        style={prim.stroke ? "stroke" : "fill"}
        strokeWidth={prim.stroke?.width}
        strokeCap="round"
        strokeJoin="round"
        blendMode={blendMode}
      >
        {paintChild(prim.paint)}
        {maskBlur}
      </Path>
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
