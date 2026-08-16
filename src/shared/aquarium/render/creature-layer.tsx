"use no memo"; // Reads/writes Reanimated SharedValues from `useV2Swim`, same
// reason as `fish-layer.tsx`'s pragma.
//
// The non-molly counterpart to `fish-layer.tsx`: shares its exact swim
// engine (`sim/use-v2-swim.ts`, already species-agnostic) and perspective-
// matrix transform math. Every `locomotion: "rigid"` species (snail, frog,
// turtle, otter) renders a plain `<Image>` — no spine-warp shader, since a
// shell/legs silhouette isn't meant to bend. The one `locomotion:
// "undulating"` species (axolotl) DOES spine-warp, via the same
// `core/sksl/warp.ts` shader and `fish/spine.ts` amplitude/wavenumber
// constants `fish-layer.tsx` uses — the warp operates on a baked texture's
// bounds generically, nothing about it is fish-shaped, so reusing those
// tuned constants here is a reasonable starting point (not re-measured for
// axolotl's own proportions the way `verify-aquarium.ts` measures fish's).
//
// The transform math below is a deliberate, documented duplication of
// `fish-layer.tsx`'s — not a shared import — so shipping this file can never
// regress the already-verified molly renderer (`verify:aquarium`'s bake/
// swim-trace gates test `fish-layer.tsx`'s exact tuning). Consolidate only
// if a real behavioural need arises.

import {
  ColorMatrix,
  FilterMode,
  Group,
  Image as SkiaImage,
  ImageShader,
  MipmapMode,
  Paint,
  Rect,
  Shader,
  Skia,
  type Matrix4,
  type Transforms3d,
  type Uniforms,
} from "@shopify/react-native-skia";
import { PixelRatio } from "react-native";
import { useDerivedValue, type SharedValue } from "react-native-reanimated";

import { sandHeightFor } from "@/shared/constants/tank";
import { getSpeciesDef } from "@/shared/creature/catalog";

import type { BakedArt } from "../core/bake";
import { densityAwareDpr } from "../core/bake";
import { getWarpEffect } from "../core/sksl/warp";
import type { CreatureSpeciesId } from "../creatures/bake-placeholder";
import { SPINE_AMP_MAX, SPINE_AMP_MIN, SPINE_K, SPINE_PAD } from "../fish/spine";
import type { SceneLayer } from "../scene/types";
import { biasedDepthRange, personalityFor } from "../sim/personality";
import { Z_MAX } from "../sim/swim";
import { useV2Swim, type V2WanderBox } from "../sim/use-v2-swim";
import { getCachedCreature } from "./creature-cache";
import { DEAD_GRAYSCALE_MATRIX, DEAD_OPACITY } from "./dead-fish";

function lerp(a: number, b: number, t: number): number {
  "worklet"; // see fish-layer.tsx's identical helper for why this directive
  // is required (called from a UI-thread useDerivedValue, not just JS).
  return a + (b - a) * t;
}

/** Zero-amplitude placeholder for the warp shader's fin-secondary uniforms — see `WarpedCreatureBody`'s `uniforms` comment. */
const INERT_FIN_HUB = [0, 0, 1, 1];

/** Mirrors `fish-layer.tsx`'s identical constant — see that file's doc comment for the tuning loop. */
const ARC_GAIN_PX_PER_RAD = 30;
/** Mirrors `fish-layer.tsx`'s identical constant — see that file's doc comment for the tuning loop. */
const TURN_BEND_GAIN_PX_PER_RAD = 8;

interface WarpedCreatureBodyProps {
  baked: BakedArt;
  phaseOffset: number;
  beatPhase: SharedValue<number>;
  speedNorm: SharedValue<number>;
  yaw: SharedValue<number>;
  /** Turn-commitment scalar driving the body-bend term below — see `fish-layer.tsx`'s `ARC_GAIN_PX_PER_RAD` doc comment. */
  roll: SharedValue<number>;
}

/** `fish-layer.tsx`'s `WarpedBody`, unchanged in every particular except its name — see this file's header for why that's a deliberate duplication, not a shared import. */
function WarpedCreatureBody({
  baked,
  phaseOffset,
  beatPhase,
  speedNorm,
  yaw,
  roll,
}: WarpedCreatureBodyProps) {
  const effect = getWarpEffect(Skia);
  const imageRect = Skia.XYWHRect(
    baked.bounds.x,
    baked.bounds.y,
    baked.bounds.width,
    baked.bounds.height,
  );

  const uniforms = useDerivedValue<Uniforms>(() => {
    const edgeOnDamp = lerp(0.35, 1, Math.abs(Math.cos(yaw.value)));
    // See fish-layer.tsx's identical derivation for why the sign correction
    // is load-bearing (the warp runs in pre-mirror local space).
    const mirrorSign = Math.cos(yaw.value) >= 0 ? -1 : 1;
    const bendAmp = roll.value * TURN_BEND_GAIN_PX_PER_RAD * mirrorSign;
    return {
      boundsX: baked.bounds.x,
      boundsWidth: baked.bounds.width,
      ampScale: lerp(SPINE_AMP_MIN, SPINE_AMP_MAX, Math.min(1, speedNorm.value)) * edgeOnDamp,
      k: SPINE_K,
      phase: beatPhase.value + phaseOffset,
      bendAmp,
      // The shared warp shader (core/sksl/warp.ts) now also takes fin
      // secondary-rotation uniforms for molly's pectoral/caudal scull (see
      // fish-layer.tsx) — creatures have no equivalent fins, so these are
      // inert no-ops: zero amplitude, and a non-zero degenerate radius
      // (never 0 — the shader divides by it) so the falloff math stays
      // well-defined even though it's never visible.
      pecNearHub: INERT_FIN_HUB,
      pecFarHub: INERT_FIN_HUB,
      caudalHub: INERT_FIN_HUB,
      pecNearAmp: 0,
      pecFarAmp: 0,
      caudalAmp: 0,
    };
  });

  if (!effect) {
    return <SkiaImage image={baked.image} rect={imageRect} fit="fill" />;
  }

  const padded = Skia.XYWHRect(
    baked.bounds.x - SPINE_PAD,
    baked.bounds.y - SPINE_PAD,
    baked.bounds.width + SPINE_PAD * 2,
    baked.bounds.height + SPINE_PAD * 2,
  );
  return (
    <Rect rect={padded}>
      <Shader source={effect} uniforms={uniforms}>
        <ImageShader
          image={baked.image}
          rect={imageRect}
          fit="fill"
          tx="decal"
          ty="decal"
          sampling={{ filter: FilterMode.Linear, mipmap: MipmapMode.Linear }}
        />
      </Shader>
    </Rect>
  );
}

export interface CreatureLayerProps {
  speciesId: CreatureSpeciesId;
  variant: string;
  status: "alive" | "dead";
  bounds: { width: number; height: number };
  /** Final render scale (life stage x any session growth x sizeRatio), BEFORE the tank-mode shrink below — see `use-owned-fish.ts`'s `sizeRatio` comment: it's already baked into this value. */
  scale: number;
  /** Stable per-fish value in [0,1). */
  seed: number;
  mode?: "tank" | "center";
  /** [0,1) depth cue, tank mode only — see aquarium-canvas.tsx's `depthOf`. */
  depth?: number;
  /** Depth band, tank mode only — see aquarium-canvas.tsx's `bandOf`. */
  band?: SceneLayer;
  /** Apply the tank-mode shrink even in `mode="center"` — see `fish-layer.tsx`'s `FishLayerProps.shrinkToTankScale`. */
  shrinkToTankScale?: boolean;
}

/** Mirrors `fish-layer.tsx`'s `AQUARIUM_FISH_SCALE` — kept as a separate constant so a future per-renderer tuning divergence doesn't require touching the fish file. */
const AQUARIUM_CREATURE_SCALE = 0.6;
const MAX_RENDER_SCALE_TANK = 1.2 * AQUARIUM_CREATURE_SCALE;
const MAX_RENDER_SCALE_CENTER = 1.2;
const EDGE_ON_MIN_WIDTH = 0.3;
const PERSPECTIVE_RATIO = 2.2;

export function CreatureLayer({
  speciesId,
  variant,
  status,
  bounds,
  scale: baseScale,
  seed,
  mode = "tank",
  depth,
  band,
  shrinkToTankScale = false,
}: CreatureLayerProps) {
  const dead = status === "dead";
  const hasDepth = mode === "tank" && depth !== undefined;
  const phase = seed * Math.PI * 2;

  const shrink = mode === "tank" || shrinkToTankScale;
  const scale = shrink ? baseScale * AQUARIUM_CREATURE_SCALE : baseScale;

  const dpr = densityAwareDpr(
    PixelRatio.get(),
    shrink ? MAX_RENDER_SCALE_TANK : MAX_RENDER_SCALE_CENTER,
  );
  const baked = getCachedCreature(speciesId, variant, dpr);

  const personality = personalityFor(seed);
  const boldInset = 1 - personality.boldness * 0.35;
  const bakedHalfWidth = baked ? (baked.bounds.width * scale) / 2 : 0;
  const insetX = Math.min(64, Math.max(28, bakedHalfWidth * 0.7)) * boldInset;
  const insetTop = Math.min(40, bounds.height * 0.08) * boldInset;
  const insetBottom = Math.min(30, bounds.height * 0.06) * boldInset;
  const isFront = mode === "tank" && band === "front";
  const box: V2WanderBox =
    mode === "center"
      ? {
          minX: bounds.width * 0.3,
          maxX: bounds.width * 0.7,
          minY: bounds.height * 0.3,
          maxY: bounds.height * 0.62,
        }
      : (() => {
          const minX = isFront ? bounds.width * 0.2 : insetX;
          const maxX = isFront ? bounds.width * 0.86 : Math.max(insetX + 1, bounds.width - insetX);
          const rawMaxY =
            Math.max(insetTop + 1, bounds.height - sandHeightFor(bounds.height) - insetBottom) -
            (hasDepth ? (1 - (depth ?? 0)) * bounds.height * 0.06 : 0) -
            (isFront ? bounds.height * 0.12 : 0);
          const { minY, maxY } = biasedDepthRange(insetTop, rawMaxY, personality.depthBias);
          return { minX, maxX, minY, maxY };
        })();

  const swim = useV2Swim({
    box,
    seed,
    speedFactor: (mode === "center" ? 0.45 : 1.25) * personality.speedFactor,
    enabled: !dead,
  });

  const depthScale = hasDepth ? scale * lerp(0.82, 1.08, depth ?? 0) : scale;
  const depthOpacity = hasDepth ? lerp(0.78, 1, depth ?? 0) : 1;
  const bakedWidth = baked ? baked.bounds.width : 1;

  const liveTransform = useDerivedValue<Transforms3d>(() => {
    const yaw = swim.yaw.value;
    const roll = swim.roll.value;
    const pitch = swim.pitch.value;
    const beatPhase = swim.beatPhase.value + phase;
    const bob = Math.sin(beatPhase) * 1.5 * Math.max(0.3, swim.speedNorm.value);
    const zNorm01 = Math.max(0, Math.min(1, swim.z.value / Z_MAX / 2 + 0.5));
    const renderScale = depthScale * lerp(0.92, 1.08, zNorm01);
    const wobble = 2.5 * Math.abs(Math.sin(yaw)) * Math.sin(beatPhase);
    // See fish-layer.tsx's identical `arcOffset` for the reasoning — applies
    // to every species here (rigid or undulating), since it's a position
    // cue, not a body-warp one.
    const arcOffset = roll * ARC_GAIN_PX_PER_RAD;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const w = -(c >= 0 ? 1 : -1) * Math.max(Math.abs(c), EDGE_ON_MIN_WIDTH);
    const q = s / (PERSPECTIVE_RATIO * bakedWidth * renderScale);
    const matrix: Matrix4 = [w, 0, 0, 0, 0, Math.cos(roll), 0, 0, 0, 0, 1, 0, q, 0, 0, 1];
    return [
      { translateX: swim.x.value + wobble },
      { translateY: swim.y.value + bob + arcOffset },
      { rotate: pitch * Math.cos(yaw) },
      { matrix },
      { scaleX: renderScale },
      { scaleY: renderScale },
    ];
  });

  if (!baked) return null;

  if (dead) {
    const rect = Skia.XYWHRect(
      baked.bounds.x,
      baked.bounds.y,
      baked.bounds.width,
      baked.bounds.height,
    );
    const restingHalfHeight = (baked.bounds.height / 2) * scale;
    const deadX = insetX + ((seed * 9973) % 1) * Math.max(1, bounds.width - insetX * 2);
    const deadY = bounds.height - sandHeightFor(bounds.height) * 0.4 - restingHalfHeight;
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
        <SkiaImage image={baked.image} rect={rect} fit="fill" />
      </Group>
    );
  }

  if (getSpeciesDef(speciesId).locomotion === "undulating") {
    return (
      <Group transform={liveTransform} opacity={depthOpacity}>
        <WarpedCreatureBody
          baked={baked}
          phaseOffset={phase}
          beatPhase={swim.beatPhase}
          speedNorm={swim.speedNorm}
          yaw={swim.yaw}
          roll={swim.roll}
        />
      </Group>
    );
  }

  const imageRect = Skia.XYWHRect(
    baked.bounds.x,
    baked.bounds.y,
    baked.bounds.width,
    baked.bounds.height,
  );
  return (
    <Group transform={liveTransform} opacity={depthOpacity}>
      <SkiaImage image={baked.image} rect={imageRect} fit="fill" />
    </Group>
  );
}
