"use no memo"; // Reads/writes Reanimated SharedValues from `useV2Swim`, and
// a mutable module-level bake/effect cache handle — the same pattern (and
// the same reason) as `fish-3d.tsx`'s "use no memo" pragma: React Compiler
// can't verify these are safe to memoise across renders.
//
// Alive fish render through the spine-warp shader (`core/sksl/warp.ts`) so
// the whole body/fin/tail silhouette bends as one piece while swimming. If
// the runtime refuses to compile the effect (`getWarpEffect` returns null —
// shouldn't happen, but see its doc comment), this degrades to the plain
// rigid `<Image>` Phase 1 shipped, matching `fish-picture.ts`'s
// `FISH_RENDER_MODE` degradation contract. Dead fish never animate (a
// corpse doesn't swim), so they always use the rigid path.

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
import { DEAD_GRAYSCALE_MATRIX, DEAD_OPACITY } from "@/shared/fish/render-spec";
import type { FishTraits, LifeStage } from "@/shared/fish/types";

import type { BakedArt } from "../core/bake";
import { getWarpEffect } from "../core/sksl/warp";
import { densityAwareDpr } from "../fish/bake-fish";
import { SPINE_AMP_MAX, SPINE_AMP_MIN, SPINE_K, SPINE_PAD } from "../fish/spine";
import type { SceneLayer } from "../scene/types";
import { biasedDepthRange, personalityFor } from "../sim/personality";
import { Z_MAX } from "../sim/swim";
import { useV2Swim, type V2WanderBox } from "../sim/use-v2-swim";
import { getCachedFish } from "./fish-cache";

function lerp(a: number, b: number, t: number): number {
  "worklet"; // called from inside WarpedBody's useDerivedValue (UI thread), not
  // just the plain render body — unlike the old fish-sprite.tsx's identical
  // helper, which only ever ran on the JS thread. Without this directive the
  // Worklets runtime treats it as a remote (JS-only) function and throws on
  // any synchronous UI-thread call.
  return a + (b - a) * t;
}

export interface FishLayerProps {
  traits: FishTraits;
  stage: LifeStage;
  status: "alive" | "dead";
  bounds: { width: number; height: number };
  /** Final render scale (life stage x any session growth), BEFORE `AQUARIUM_FISH_SCALE`. */
  scale: number;
  /** Stable per-fish value in [0,1). */
  seed: number;
  mode?: "tank" | "center";
  /** [0,1) depth cue, tank mode only — see tank-canvas.tsx's `depthOf`. */
  depth?: number;
  /** Depth band, tank mode only — see aquarium-canvas.tsx's `bandOf`. Narrows the wander box for "front". */
  band?: SceneLayer;
}

/**
 * Tank-mode-only shrink so the tank reads as roomier — real aquascape decor
 * and fish are nowhere near 30-45% of the tank's width, which is what the
 * unscaled bake was drawing at. Session/result-sheet `mode="center"` is
 * unaffected: that fish IS the focal element, not a inhabitant of a wider
 * scene. Never touch the shared `TANK_FISH_SCALE` constant — the legacy 2D
 * renderer still uses it.
 */
const AQUARIUM_FISH_SCALE = 0.6;

/** Upper bound on `scale × AQUARIUM_FISH_SCALE` (or unscaled in center mode) — feeds bake DPR so the largest fish stays crisp without over-baking the common case. */
const MAX_RENDER_SCALE_TANK = 1.2 * AQUARIUM_FISH_SCALE;
const MAX_RENDER_SCALE_CENTER = 1.2;

/**
 * Minimum on-screen width fraction at edge-on (`yaw = ±π/2`) — a hard floor
 * baked into the perspective matrix `M`, not a yaw clamp. Clamping yaw
 * plateaus visibly; floored width keeps the turn's rotation honest while
 * the silhouette (full dorsal, full caudal fan, the eye) stays readable
 * through the thinnest part of a turn.
 */
const EDGE_ON_MIN_WIDTH = 0.3;

/**
 * Foreshortening as a ratio of on-screen fish length rather than a bare
 * pixel constant — a fixed `perspective(550)` shrinks with the fish (13%
 * foreshortening pre-2D-V2-scale, 8% at `AQUARIUM_FISH_SCALE`) and stops
 * reading exactly when scale drops. `q = sin(yaw) / (PERSPECTIVE_RATIO *
 * onScreenWidth)` gives ±23% at 90° regardless of render scale, and
 * `|q·x| ≤ 1/(2·RATIO) = 0.227 < 1` keeps `w` from ever crossing zero.
 */
const PERSPECTIVE_RATIO = 2.2;

interface WarpedBodyProps {
  baked: BakedArt;
  phaseOffset: number;
  beatPhase: SharedValue<number>;
  speedNorm: SharedValue<number>;
  yaw: SharedValue<number>;
}

/** The swim-bend body: a padded rect, warped through the fish's own baked texture. */
function WarpedBody({ baked, phaseOffset, beatPhase, speedNorm, yaw }: WarpedBodyProps) {
  const effect = getWarpEffect(Skia);
  const imageRect = Skia.XYWHRect(
    baked.bounds.x,
    baked.bounds.y,
    baked.bounds.width,
    baked.bounds.height,
  );

  const uniforms = useDerivedValue<Uniforms>(() => {
    // Edge-on, the warp's local-y displacement reads as a thin sliver
    // waving up/down instead of a head-on tail sweeping side to side —
    // damp it there; fish-layer.tsx's translateX wobble pays the motion
    // back as a horizontal shimmy instead.
    const edgeOnDamp = lerp(0.35, 1, Math.abs(Math.cos(yaw.value)));
    return {
      boundsX: baked.bounds.x,
      boundsWidth: baked.bounds.width,
      ampScale: lerp(SPINE_AMP_MIN, SPINE_AMP_MAX, Math.min(1, speedNorm.value)) * edgeOnDamp,
      k: SPINE_K,
      phase: beatPhase.value + phaseOffset,
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

export function FishLayer({
  traits,
  stage,
  status,
  bounds,
  scale: baseScale,
  seed,
  mode = "tank",
  depth,
  band,
}: FishLayerProps) {
  const dead = status === "dead";
  const hasDepth = mode === "tank" && depth !== undefined;
  const phase = seed * Math.PI * 2;

  // AQUARIUM_FISH_SCALE only applies in tank mode — the session screen's
  // single centered fish IS the focal element, not an inhabitant of a wider
  // scene, so it keeps its original scale.
  const scale = mode === "tank" ? baseScale * AQUARIUM_FISH_SCALE : baseScale;

  const dpr = densityAwareDpr(
    PixelRatio.get(),
    mode === "tank" ? MAX_RENDER_SCALE_TANK : MAX_RENDER_SCALE_CENTER,
  );
  const baked = getCachedFish(traits, stage, dpr);

  // Per-fish personality (pure function of seed — see sim/personality.ts):
  // bolder fish roam closer to the glass, all fish cruise at their own
  // pace, and each settles toward its own preferred depth band, so a tank
  // full of fish doesn't read as one particle replayed at different phases.
  const personality = personalityFor(seed);
  const boldInset = 1 - personality.boldness * 0.35;
  // Derived from the fish's OWN baked extent instead of a flat fraction of
  // the canvas: a flat `min(48, w*0.1)` let a large fish's nose sit off-
  // canvas at the wall and gave a tiny fish an oversized, empty-looking
  // margin — neither scales with what's actually being drawn.
  const bakedHalfWidth = baked ? (baked.bounds.width * scale) / 2 : 0;
  const insetX = Math.min(64, Math.max(28, bakedHalfWidth * 0.7)) * boldInset;
  const insetTop = Math.min(40, bounds.height * 0.08) * boldInset;
  const insetBottom = Math.min(30, bounds.height * 0.06) * boldInset;
  // The front band sits nearest the glass, over foreground decor — narrowed
  // so those fish don't crowd the tank's edges or sit on top of the
  // foreground pieces the scene puts there.
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
          return {
            minX,
            maxX,
            minY,
            maxY,
          };
        })();

  const swim = useV2Swim({
    box,
    seed,
    // Tank mode was 1.25 — bumped there because screen-x speed is cut by
    // |cos yaw| and cruising fish looked stalled. Pulled back to 0.88 for a
    // calmer, more watchable pace (the reference scene's single fish drifts;
    // it doesn't commute). Still comfortably above "stalled" because the
    // shared current below keeps everyone gently moving even mid-glide.
    // NOTE: this is app-level tuning only — `verify-aquarium.ts`'s swim
    // trace exercises the engine at speedFactor 1, so its cruise-speed floor
    // is unaffected by this number.
    speedFactor: (mode === "center" ? 0.45 : 0.88) * personality.speedFactor,
    // Molly-only: the five creature species in `creature-layer.tsx` pass
    // nothing here and keep their existing independent motion. Measured with
    // individual wander averaged out (400 fish, 60s): this sways the tank's
    // centroid ~66px on the current's own ~42s cycle, against ~10px of
    // residual drift with the current off — i.e. the group visibly moves as
    // one body of water. Peak drift is ~12px/s vs ~32px/s of swimming, so a
    // fish heading upstream still makes headway.
    currentStrength: mode === "tank" ? 1 : 0,
    enabled: !dead,
  });

  const depthScale = hasDepth ? scale * lerp(0.82, 1.08, depth ?? 0) : scale;
  const depthOpacity = hasDepth ? lerp(0.78, 1, depth ?? 0) : 1;
  const bakedWidth = baked ? baked.bounds.width : 1;

  const liveTransform = useDerivedValue<Transforms3d>(() => {
    const yaw = swim.yaw.value;
    const roll = swim.roll.value;
    const pitch = swim.pitch.value;
    const beatPhase = swim.beatPhase.value;
    const bob = Math.sin(beatPhase) * 1.5 * Math.max(0.3, swim.speedNorm.value);
    // Small volume cue as the fish steers through depth (z, not the
    // structural per-fish `depth` prop that already drives depthScale
    // above) — kept weak so a back-band fish coming forward never reads as
    // if it should occlude mid-layer decor.
    const zNorm01 = Math.max(0, Math.min(1, swim.z.value / Z_MAX / 2 + 0.5));
    const renderScale = depthScale * lerp(0.92, 1.08, zNorm01);
    // Pays back the motion the edge-on spine-warp damping (WarpedBody,
    // above) removes: broadside the body bends, edge-on it shimmies
    // horizontally instead, and the two cross-fade with |sin yaw|.
    const wobble = 2.5 * Math.abs(Math.sin(yaw)) * Math.sin(beatPhase);
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    // Art is nose-left: yaw=0 is heading +x (rightward), which must draw
    // mirrored (nose right), so w<0 there — verified against `toMatrix3`'s
    // index mapping in node_modules directly, see the plan doc.
    const w = -(c >= 0 ? 1 : -1) * Math.max(Math.abs(c), EDGE_ON_MIN_WIDTH);
    const q = s / (PERSPECTIVE_RATIO * bakedWidth * renderScale);
    const matrix: Matrix4 = [w, 0, 0, 0, 0, Math.cos(roll), 0, 0, 0, 0, 1, 0, q, 0, 0, 1];
    return [
      { translateX: swim.x.value + wobble },
      { translateY: swim.y.value + bob },
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

  return (
    <Group transform={liveTransform} opacity={depthOpacity}>
      <WarpedBody
        baked={baked}
        phaseOffset={phase}
        beatPhase={swim.beatPhase}
        speedNorm={swim.speedNorm}
        yaw={swim.yaw}
      />
    </Group>
  );
}
