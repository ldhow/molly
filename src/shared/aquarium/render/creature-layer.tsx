"use no memo"; // Reads/writes Reanimated SharedValues from `useV2Swim`, same
// reason as `fish-layer.tsx`'s pragma.
//
// The non-molly counterpart to `fish-layer.tsx`: shares its exact swim
// engine (`sim/use-v2-swim.ts`, already species-agnostic) and perspective-
// matrix transform math. Every `locomotion: "rigid"` species (turtle, otter)
// renders a plain `<Image>` — no spine-warp shader, since a shell/legs
// silhouette isn't meant to bend. The one `locomotion: "undulating"` species
// (axolotl) DOES spine-warp, via the same `core/sksl/warp.ts` shader and
// `fish/spine.ts` amplitude/wavenumber constants `fish-layer.tsx` uses — the
// warp operates on a baked texture's bounds generically, nothing about it is
// fish-shaped, so reusing those tuned constants here is a reasonable
// starting point (not re-measured for axolotl's own proportions the way
// `verify-aquarium.ts` measures fish's).
//
// The `locomotion: "crawl"` species (snail, shrimp) do neither: they are
// bound to a surface by `sim/crawl.ts` and rendered by `CrawlingCreature`
// below, which shares none of the swim transform math — a crawler has one
// degree of freedom (arc length along a track), so there is no yaw, no depth
// steering and no edge-on width floor to reproduce.
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
import { memo, useMemo } from "react";
import { PixelRatio } from "react-native";
import { useDerivedValue, type SharedValue } from "react-native-reanimated";

import { sandHeightFor } from "@/shared/constants/tank";
import { getSpeciesDef } from "@/shared/creature/catalog";

import type { BakedArt } from "../core/bake";
import { densityAwareDpr } from "../core/bake";
import {
  getWarpEffect,
  RELIGHT_OFF_UNIFORMS,
  RELIGHT_STATIC_UNIFORMS,
  relightYaw,
} from "../core/sksl/warp";
import type { CreaturePart } from "../creatures/bake-creature";
import type { CreatureSpeciesId } from "../creatures/bake-placeholder";
import { ANTENNA_PIVOT } from "../creatures/shrimp/anatomy";
import { TENTACLE_PIVOT } from "../creatures/snail/anatomy";
import type { XY } from "../core/ir";
import { SPINE_AMP_MAX, SPINE_AMP_MIN, SPINE_K, SPINE_PAD } from "../fish/spine";
import type { SceneLayer } from "../scene/types";
import {
  buildCenterCrawlTrack,
  buildCrawlTrack,
  type ClimbProp,
  type CrawlBox,
} from "../sim/crawl";
import { useCrawl } from "../sim/use-crawl";
import { biasedDepthRange, personalityFor } from "../sim/personality";
import { Z_MAX } from "../sim/swim";
import { useV2Swim, type V2WanderBox } from "../sim/use-v2-swim";
import { getCachedCreature } from "./creature-cache";
import { getCachedAxolotlNormalMap } from "./normal-cache";
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
  /**
   * The species' body normal field, or null for a species that has none —
   * which is every creature except the axolotl (see
   * `creatures/axolotl/normal-map.ts`). Null means the relight gains go to
   * zero, at which point the second child shader's contents stop mattering
   * and this can reuse `baked` rather than allocate a placeholder.
   */
  normal: BakedArt | null;
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
  normal,
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
  // Both children sample the same local-space coordinate, so differing
  // rects align by construction — see fish-layer.tsx for the same note.
  const hasNormal = normal !== null;
  const normalArt = normal ?? baked;
  const normalRect = Skia.XYWHRect(
    normalArt.bounds.x,
    normalArt.bounds.y,
    normalArt.bounds.width,
    normalArt.bounds.height,
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
      // Relight (core/shading.ts DYNAMIC_RELIGHT). Live for the axolotl,
      // which is the only creature with a body normal field; identity for
      // everything else. Not optional either way — SkSL binds uniforms by
      // name and the draw throws if a declared one is missing.
      ...(hasNormal ? RELIGHT_STATIC_UNIFORMS : RELIGHT_OFF_UNIFORMS),
      ...(hasNormal ? relightYaw(yaw.value) : { yawCos: 1, yawSin: 0 }),
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
        {/* The relight child: the axolotl's normal field, or the body
            texture itself for every other species — with the gains at zero
            its contents are never read, so that costs nothing and avoids a
            placeholder allocation. `decal` is load-bearing: outside the rect
            the shader must read (0,0,0,0) so its mask lands at 0. */}
        <ImageShader
          image={normalArt.image}
          rect={normalRect}
          fit="fill"
          tx="decal"
          ty="decal"
          sampling={{ filter: FilterMode.Linear, mipmap: MipmapMode.None }}
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
  /** Climbable decor in this individual's own depth band, tank mode only — only `locomotion: "crawl"` species read it. Must come from the SAME parallax group this layer renders in, or the snail would climb a stem that is drawn somewhere else. */
  climbProps?: ClimbProp[];
}

/** Mirrors `fish-layer.tsx`'s `AQUARIUM_FISH_SCALE` — kept as a separate constant so a future per-renderer tuning divergence doesn't require touching the fish file. */
const AQUARIUM_CREATURE_SCALE = 0.4;
/** Pinned at the 0.48 equivalent rather than derived from the shrink above — see `fish-layer.tsx`'s `MAX_RENDER_SCALE_TANK` for why the two are deliberately decoupled. */
const MAX_RENDER_SCALE_TANK = 1.2 * 0.48;
const MAX_RENDER_SCALE_CENTER = 1.2;
const EDGE_ON_MIN_WIDTH = 0.3;
const PERSPECTIVE_RATIO = 2.2;

/** Every swimming species — `locomotion` `"rigid"` or `"undulating"`. Split out of `CreatureLayer` so the crawl engine can be a sibling rather than a branch inside a component that has already called the swim hook. */
function SwimmingCreature({
  speciesId,
  variant,
  bounds,
  scale: baseScale,
  seed,
  mode = "tank",
  depth,
  band,
  shrinkToTankScale = false,
}: CreatureLayerProps) {
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
          // Mirrors `fish-layer.tsx`'s identical fix — see its comment for
          // the full reasoning (a narrower box's "clear" zone between the
          // two walls' `WALL_MARGIN_X` avoidance ranges was smaller than one
          // wall-avoidance turn's arc, so the steer-toward-centre target
          // flipped sign before a turn finished, reading as rapid flipping).
          minX: bounds.width * 0.12,
          maxX: bounds.width * 0.88,
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
    enabled: true,
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

  if (getSpeciesDef(speciesId).locomotion === "undulating") {
    return (
      <Group transform={liveTransform} opacity={depthOpacity}>
        <WarpedCreatureBody
          normal={speciesId === "axolotl" ? getCachedAxolotlNormalMap() : null}
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

// ---------------------------------------------------------------------------
// Crawling species
// ---------------------------------------------------------------------------

/** How far the sand line a crawler's sole sits — a hair INTO the substrate, so it reads as gripping it rather than balanced on top (same "grounded" trick `compose-sprites.ts` uses for decor). */
const SUBSTRATE_BITE = 3;
/** Inset from the canvas edge for the two panes of glass. */
const GLASS_INSET = 5;
/** Sway: peak swing in radians, and how fast it wanders. */
const SWAY_AMP = 0.13;
const SWAY_FREQ = 0.62;
/** Peak longitudinal stretch of the body over one pedal wave. A crawler's foot visibly lengthens and gathers as each muscular wave runs down it. */
const PEDAL_STRETCH = 0.035;

/**
 * Every `locomotion: "crawl"` species bakes a second, independently-swaying
 * appendage on top of its otherwise-rigid body — the snail's eye stalks, the
 * shrimp's antennae — because a rigid texture sliding along a wall with
 * nothing else moving reads as a sticker, not an animal (see
 * `creatures/snail/bake-creature.ts`'s header). This is the one place that
 * knows which `CreaturePart` and which pivot each species uses; a species
 * with no entry here just draws its `"full"` bake with no second piece.
 */
const SWAY_RIG: Partial<Record<CreatureSpeciesId, { part: CreaturePart; pivot: XY }>> = {
  snail: { part: "tentacles", pivot: TENTACLE_PIVOT },
  shrimp: { part: "antennae", pivot: ANTENNA_PIVOT },
};

/**
 * Which `crawl` species can occasionally dash — a decisive straight-line
 * swim through open water between two points on the track, instead of
 * following the surface the whole way (see `sim/crawl.ts`'s `stepCrawl`
 * header). A snail has no swim degree of freedom at all and is never in this
 * map; a shrimp spends most of its time crawling exactly like a snail but
 * occasionally darts, which is what real aquarium shrimp actually do.
 */
const DASH_CAPABLE: Partial<Record<CreatureSpeciesId, boolean>> = {
  shrimp: true,
};

/**
 * A `locomotion: "crawl"` species: stuck to `sim/crawl.ts`'s track for
 * almost all of its time on screen. The whole transform is "put the sole on
 * the surface and turn to match it" — `translate(contact)` then
 * `rotate(surface tangent)` — which works unchanged on the substrate, on
 * either pane of glass, and up and over a plant stem, because the art is
 * authored with its sole at local y = 0 (see `creatures/snail/anatomy.ts`).
 * `DASH_CAPABLE` species (the shrimp) are the one exception: `crawl.x/y`
 * briefly leave the track mid-dash, and this same transform still places
 * them correctly since it only ever reads `crawl.x/y/angle`, never the track
 * itself.
 *
 * Two textures, not one, for any species with a `SWAY_RIG` entry: the swaying
 * appendage bakes separately and rotates about its own pivot under the body,
 * independently of the shell/carapace. See `creatures/snail/bake-creature.ts`
 * for why that is worth a second draw call.
 */
function CrawlingCreature({
  speciesId,
  variant,
  bounds,
  scale: baseScale,
  seed,
  mode = "tank",
  depth,
  shrinkToTankScale = false,
  climbProps,
}: CreatureLayerProps) {
  const hasDepth = mode === "tank" && depth !== undefined;
  const phase = seed * Math.PI * 2;

  const shrink = mode === "tank" || shrinkToTankScale;
  const scale = shrink ? baseScale * AQUARIUM_CREATURE_SCALE : baseScale;
  const dpr = densityAwareDpr(
    PixelRatio.get(),
    shrink ? MAX_RENDER_SCALE_TANK : MAX_RENDER_SCALE_CENTER,
  );
  const swayRig = SWAY_RIG[speciesId];
  const body = getCachedCreature(speciesId, variant, dpr, "body");
  const swayPiece = swayRig ? getCachedCreature(speciesId, variant, dpr, swayRig.part) : null;

  const personality = personalityFor(seed);
  const sand = sandHeightFor(bounds.height);
  const box: CrawlBox = useMemo(
    () =>
      mode === "center"
        ? {
            minX: bounds.width * 0.16,
            maxX: bounds.width * 0.84,
            // No substrate on the plain background this mode draws over, so
            // the ledge is simply the lower third of the view.
            floorY: bounds.height * 0.72,
            ceilY: bounds.height * 0.72,
          }
        : {
            minX: GLASS_INSET,
            maxX: Math.max(GLASS_INSET + 1, bounds.width - GLASS_INSET),
            floorY: bounds.height - sand + SUBSTRATE_BITE,
            // Bolder individuals are willing to climb higher up the glass.
            ceilY: bounds.height * (0.34 - personality.boldness * 0.2),
          },
    [mode, bounds.width, bounds.height, sand, personality.boldness],
  );
  const track = useMemo(
    () =>
      mode === "center" ? buildCenterCrawlTrack(box) : buildCrawlTrack(box, seed, climbProps ?? []),
    [mode, box, seed, climbProps],
  );

  const crawl = useCrawl({
    track,
    seed,
    speedFactor: (mode === "center" ? 0.6 : 1) * personality.speedFactor,
    enabled: true,
    canDash: DASH_CAPABLE[speciesId] ?? false,
  });

  const depthScale = hasDepth ? scale * lerp(0.86, 1.06, depth ?? 0) : scale;
  const depthOpacity = hasDepth ? lerp(0.8, 1, depth ?? 0) : 1;

  const bodyTransform = useDerivedValue<Transforms3d>(() => {
    const wave = Math.sin(crawl.wavePhase.value + phase);
    // The pedal wave gathers and lengthens the foot; the shell rocks a little
    // with it. Both are damped by how fast it is actually moving, so a
    // grazing snail settles instead of pulsing on the spot.
    const drive = 0.25 + 0.75 * crawl.speedNorm.value;
    return [
      { translateX: crawl.x.value },
      { translateY: crawl.y.value },
      { rotate: crawl.angle.value },
      { scaleX: crawl.dir.value * depthScale * (1 + PEDAL_STRETCH * wave * drive) },
      { scaleY: depthScale * (1 - PEDAL_STRETCH * 0.6 * wave * drive) },
    ];
  });

  const swayPivot = swayRig?.pivot ?? { x: 0, y: 0 };
  const swayTransform = useDerivedValue<Transforms3d>(() => {
    // Two incommensurate frequencies so the appendage never settles into an
    // obvious loop, plus a slow lean into the direction of travel.
    const t = crawl.elapsed.value;
    const sway =
      SWAY_AMP * Math.sin(t * SWAY_FREQ * Math.PI * 2 + phase) +
      SWAY_AMP * 0.55 * Math.sin(t * SWAY_FREQ * 1.61 * Math.PI * 2 + phase * 1.7) -
      0.06 * crawl.speedNorm.value;
    return [
      { translateX: swayPivot.x },
      { translateY: swayPivot.y },
      { rotate: sway },
      { translateX: -swayPivot.x },
      { translateY: -swayPivot.y },
    ];
  });

  if (!body) return null;

  return (
    <Group transform={bodyTransform} opacity={depthOpacity}>
      {swayPiece ? (
        <Group transform={swayTransform}>
          <SkiaImage image={swayPiece.image} rect={rectOf(swayPiece)} fit="fill" />
        </Group>
      ) : null}
      <SkiaImage image={body.image} rect={rectOf(body)} fit="fill" />
    </Group>
  );
}

// ---------------------------------------------------------------------------
// Dead
// ---------------------------------------------------------------------------

/** A dead creature: grayscale, flipped, resting on the sand. No hooks — a dead individual is a still frame, which is also why it is its own component rather than a branch inside a live one. */
function DeadCreature({ speciesId, variant, bounds, scale, seed }: CreatureLayerProps) {
  const dpr = densityAwareDpr(PixelRatio.get(), MAX_RENDER_SCALE_TANK);
  const scaled = scale * AQUARIUM_CREATURE_SCALE;
  const baked = getCachedCreature(speciesId, variant, dpr);
  if (!baked) return null;

  const personality = personalityFor(seed);
  const boldInset = 1 - personality.boldness * 0.35;
  const insetX = Math.min(64, Math.max(28, ((baked.bounds.width * scaled) / 2) * 0.7)) * boldInset;
  const deadX = insetX + ((seed * 9973) % 1) * Math.max(1, bounds.width - insetX * 2);
  const sandTop = bounds.height - sandHeightFor(bounds.height) * 0.4;

  // A crawler's art hangs entirely ABOVE its own origin (the sole is local
  // y = 0), so the generic "centre it on the sand" offset would bury a
  // capsized snail under the substrate. Flipped, its shell is what touches
  // down — which is exactly how a dead snail is found — so the origin has to
  // ride one full art-height above the sand line.
  const crawler = getSpeciesDef(speciesId).locomotion === "crawl";
  const deadY = crawler
    ? sandTop + baked.bounds.y * scaled
    : sandTop - (baked.bounds.height / 2) * scaled;

  const deadTransform: Transforms3d = [
    { translateX: deadX },
    { translateY: deadY },
    { rotate: (seed - 0.5) * 0.24 },
    { scaleX: seed > 0.5 ? scaled : -scaled },
    { scaleY: -scaled },
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
      <SkiaImage image={baked.image} rect={rectOf(baked)} fit="fill" />
    </Group>
  );
}

function rectOf(baked: BakedArt) {
  return Skia.XYWHRect(baked.bounds.x, baked.bounds.y, baked.bounds.width, baked.bounds.height);
}

/**
 * Picks the renderer for this individual. The three branches are separate
 * COMPONENTS, not branches inside one, because each owns a different set of
 * hooks (swim engine / crawl engine / none) — and because `speciesId` and
 * `status` are fixed for the life of a given `key`, so no mount ever flips
 * between them mid-animation.
 *
 * `memo`'d for the same reason (and under the same stable-props guarantee) as
 * `fish-layer.tsx`'s `FishLayer` — see its doc comment.
 */
export const CreatureLayer = memo(function CreatureLayer(props: CreatureLayerProps) {
  if (props.status === "dead") return <DeadCreature {...props} />;
  if (getSpeciesDef(props.speciesId).locomotion === "crawl") return <CrawlingCreature {...props} />;
  return <SwimmingCreature {...props} />;
});
