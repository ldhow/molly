"use no memo"; // Reads Reanimated SharedValues (the pan camera offset) via
// useSharedValue/useDerivedValue — same reasoning as parallax.tsx's pragma.

// Drop-in replacement for `@/shared/components/tank/tank-canvas.tsx`'s
// `TankCanvas` — same `{ fish, mode, style }` props — so `tank-view.tsx` can
// switch to this renderer with a third branch and every existing consumer
// (Tank screen, session screen's `mode="center"`, the result sheet) keeps
// working unchanged. This is the ONE renderer that receives the full
// `AnyTankFish[]` (molly AND the 5 new species) — see `tank-view.tsx`'s
// header for why the other two renderers only ever see molly.
//
// Dispatches each individual to `FishLayer` (molly) or `CreatureLayer`
// (every other species) via `isMollyTankFish`'s discriminant — both layers
// share the exact same swim engine and depth-band interleave, so a mixed
// tank reads as one scene, not two overlaid ones.

import { Canvas, Group, Rect } from "@shopify/react-native-skia";
import { useMemo, useState } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useDerivedValue, useSharedValue } from "react-native-reanimated";

import { palette } from "@/shared/constants/theme";
import { sandHeightFor } from "@/shared/constants/tank";
import { isMollyTankFish, type AnyTankFish, type MollyTankFish } from "@/shared/lib/tank-fish";
import { useSceneArtStore } from "@/shared/store/scene-art-store";

import {
  composeSpriteScene,
  type PlacedSprite,
  type SpriteSceneTheme,
} from "../scene/compose-sprites";
import { composeScene, type PlacedPiece } from "../scene/compose";
import { DEFAULT_SCENE_DESIGN } from "../scene/scene-design";
import { NATURE_SCAPE } from "../scene/themes/nature-scape";
import type { SceneLayer } from "../scene/types";
import type { ClimbProp } from "../sim/crawl";
import { AquariumBubbles } from "./bubbles";
import { CreatureLayer } from "./creature-layer";
import { FishLayer } from "./fish-layer";
import { ParallaxGroup, useCameraX } from "./parallax";
import { SceneLayerGroup } from "./scene-layers";
import { SpriteLayerGroup, SpriteSubstrate, SpriteWater } from "./sprite-layers";
import { AquariumSubstrate, AquariumWater } from "./water";

/** No authored theme, no procedural fill — just what `swimLanes` any sprite
 *  scene needs. Used whenever there's nothing to draw: sprite mode with an
 *  empty (or absent) `userScape`. */
const EMPTY_SPRITE_SCAPE: SpriteSceneTheme = {
  name: "empty",
  placements: [],
  swimLanes: [{ xFraction: [0.32, 0.72] }],
};

const PARALLAX_FACTOR: Record<SceneLayer, number> = {
  far: DEFAULT_SCENE_DESIGN.layers.parallaxFar,
  back: DEFAULT_SCENE_DESIGN.layers.parallaxBack,
  backMid: DEFAULT_SCENE_DESIGN.layers.parallaxBackMid,
  mid: DEFAULT_SCENE_DESIGN.layers.parallaxMid,
  frontMid: DEFAULT_SCENE_DESIGN.layers.parallaxFrontMid,
  front: DEFAULT_SCENE_DESIGN.layers.parallaxFront,
  frontMost: DEFAULT_SCENE_DESIGN.layers.parallaxFrontMost,
};

/** The 6 tiers fish/decor can actually occupy, farthest to nearest — "far" is
 *  backdrop-only and excluded (see `SceneLayer`'s doc: no fish band ever sits
 *  there). Order here IS draw order: earlier entries paint first (further
 *  back), matching the render loop below. */
const FISH_LAYERS: readonly SceneLayer[] = [
  "back",
  "backMid",
  "mid",
  "frontMid",
  "front",
  "frontMost",
];

/** The Decorate screen's "which item is selected" outline. */
const HIGHLIGHT_COLOR = palette.accent;
const HIGHLIGHT_STROKE = 3;
const HIGHLIGHT_PAD = 4;

export type AquariumFish = MollyTankFish;

interface Bounds {
  width: number;
  height: number;
}

/**
 * The scene decor/sand/fish are COMPOSED against — NOT necessarily the
 * on-screen viewport. When `pannable` is off (every screen except the main
 * Tank screen), or the viewport is already landscape-shaped, this IS the
 * viewport — unchanged from before this existed.
 *
 * When `pannable` is on and the viewport is portrait, this returns this SAME
 * DEVICE's true rotated dimensions (width/height swapped) — exactly what
 * `sizeFactorFor` and `sandHeightFor` would compute if the phone were
 * physically turned sideways. Deliberately NOT scaled afterward to fill the
 * taller portrait viewport: decor size has to come out PIXEL-IDENTICAL
 * between orientations ("kích thước cây cảnh scale y hệt"), which a
 * fill-the-height rescale would break (it would make everything bigger in
 * portrait than in landscape, on the same device). Extra portrait height
 * beyond this scene's fixed height is handled in `AquariumCanvas` by
 * bottom-anchoring this whole composed scene and letting the water simply
 * extend further above it — a deeper visible water column, not bigger decor.
 * Extra width (this scene is wider than a portrait viewport) is handled by
 * the pan gesture below.
 */
function sceneBoundsFor(viewportWidth: number, viewportHeight: number, pannable: boolean): Bounds {
  if (!pannable || viewportWidth <= 0 || viewportHeight <= 0 || viewportWidth >= viewportHeight) {
    return { width: viewportWidth, height: viewportHeight };
  }
  return { width: viewportHeight, height: viewportWidth };
}

interface Props {
  fish: AnyTankFish[];
  mode?: "tank" | "center";
  style?: ViewStyle;
  /** "plain" skips sand/decor/bubbles — just water + fish, for screens where the fish itself is the whole point (e.g. the session screen's growing fish), not an inhabitant of a wider scene. Defaults to the full nature-scape tank. */
  background?: "full" | "plain";
  /** Forwarded to `FishLayer`/`CreatureLayer` — see `FishLayerProps.shrinkToTankScale`. */
  shrinkToTankScale?: boolean;
  /**
   * User-placed decor (the Decor Store) as a ready-made sprite theme — only
   * meaningful in sprite mode. The tank shows EXACTLY this and nothing
   * else — no authored theme, no procedural backdrop fill — so an empty
   * scape (nothing bought/placed yet) is a bare tank on purpose.
   * `null`/`undefined` (no Decor Store integration on this screen) renders
   * the same bare tank via `EMPTY_SPRITE_SCAPE`.
   */
  userScape?: SpriteSceneTheme | null;
  /**
   * Composes and renders this device's own landscape-shaped scene instead of
   * squeezing to fit the viewport, with a drag-to-pan camera when that scene
   * is wider than the viewport — see `sceneBoundsFor`'s doc. Defaults to
   * `false` (today's exact-viewport behaviour, unchanged) because the
   * Decorate screen already owns a drag gesture on this same view (for
   * repositioning a selected item) that isn't set up to coordinate with a
   * second, competing pan gesture — only the main Tank screen, which has no
   * other gesture on this view, opts in.
   */
  pannable?: boolean;
  /**
   * Draws a highlight outline around the placed sprite whose `key` (see
   * `compose-sprites.ts`'s `SpritePlacement.id`) matches — the Decorate
   * screen's "which item is selected" frame. Sprite-mode only; a no-op in
   * procedural mode or when nothing matches.
   */
  highlightId?: string | null;
}

/** Deterministic [0,1) "how far back" a fish sits — same rule as tank-canvas.tsx. */
function depthOf(seed: number): number {
  return (seed * 31.7) % 1;
}

/** Quantises the continuous depth cue into the 6 bands the scene interleaves with. */
function bandOf(depth: number): SceneLayer {
  const index = Math.min(FISH_LAYERS.length - 1, Math.floor(depth * FISH_LAYERS.length));
  return FISH_LAYERS[index];
}

/** Dispatches one individual to `FishLayer` (molly) or `CreatureLayer` (everything else) — the one place that needs to know both layers exist. */
function renderDead(f: AnyTankFish, bounds: Bounds) {
  return isMollyTankFish(f) ? (
    <FishLayer
      key={f.key}
      traits={f.traits}
      stage={f.stage}
      status="dead"
      bounds={bounds}
      scale={f.scale}
      seed={f.seed}
    />
  ) : (
    <CreatureLayer
      key={f.key}
      speciesId={f.speciesId}
      variant={f.variant}
      status="dead"
      bounds={bounds}
      scale={f.scale}
      seed={f.seed}
    />
  );
}

function renderAlive(
  f: AnyTankFish & { depth: number; band: SceneLayer },
  bounds: Bounds,
  mode: "tank" | "center",
  shrinkToTankScale: boolean,
  climbProps?: ClimbProp[],
) {
  return isMollyTankFish(f) ? (
    <FishLayer
      key={f.key}
      traits={f.traits}
      stage={f.stage}
      status="alive"
      bounds={bounds}
      scale={f.scale}
      seed={f.seed}
      mode={mode}
      depth={f.depth}
      band={f.band}
      shrinkToTankScale={shrinkToTankScale}
    />
  ) : (
    <CreatureLayer
      key={f.key}
      speciesId={f.speciesId}
      variant={f.variant}
      status="alive"
      bounds={bounds}
      scale={f.scale}
      seed={f.seed}
      mode={mode}
      depth={f.depth}
      band={f.band}
      shrinkToTankScale={shrinkToTankScale}
      climbProps={climbProps}
    />
  );
}

/** Minimum height (px) a decor piece needs before a snail will treat it as climbable — anything shorter is a pebble or a carpet plant, not a stem. */
const CLIMBABLE_MIN_HEIGHT = 34;
/** How far up a piece the usable stem runs. The top of a plant is foliage that would swallow the snail, so the climb stops below it. */
const CLIMBABLE_TOP_FRACTION = 0.78;

function climbPropFrom(worldX: number, worldY: number, top: number): ClimbProp | null {
  const height = worldY - top;
  if (height < CLIMBABLE_MIN_HEIGHT) return null;
  return { x: worldX, baseY: worldY, topY: worldY - height * CLIMBABLE_TOP_FRACTION };
}

export function AquariumCanvas({
  fish,
  mode = "tank",
  style,
  background = "full",
  shrinkToTankScale = false,
  userScape = null,
  pannable = false,
  highlightId = null,
}: Props) {
  const plain = background === "plain";
  const [size, setSize] = useState({ width: 0, height: 0 });
  const dead = fish.filter((f) => f.status === "dead");
  const alive = fish
    .filter((f) => f.status === "alive")
    .map((f) => ({ ...f, depth: depthOf(f.seed), band: bandOf(depthOf(f.seed)) }))
    .sort((a, b) => a.depth - b.depth);

  const sceneArtMode = useSceneArtStore((s) => s.sceneArtMode);
  // Composed at this device's true landscape dimensions (see the doc), NEVER
  // rescaled afterward. Every size-sensitive composition call below
  // (sizeFactorFor via composeScene/composeSpriteScene, sandHeightFor) reads
  // this, so decor/sand come out pixel-identical to a real landscape screen
  // regardless of which way the phone is actually held.
  const sceneBounds = useMemo(
    () => sceneBoundsFor(size.width, size.height, pannable && !plain),
    [size.width, size.height, pannable, plain],
  );
  const substrateY = sceneBounds.height - sandHeightFor(sceneBounds.height);

  // Portrait's viewport is TALLER than this fixed-height scene — rather than
  // stretching decor to fill that extra height (which is exactly what would
  // break "kích thước cây cảnh scale y hệt"), bottom-anchor the whole
  // composed scene and let it sit lower in the viewport, water rendered
  // separately at the REAL viewport height fills the gap above it. 0 in
  // landscape (sceneBounds already IS the viewport).
  const verticalOffset = Math.max(0, size.height - sceneBounds.height);

  // How far the scene can be dragged: 0 in landscape (sceneBounds === the
  // viewport, nothing to reveal), up to its full extra width in portrait.
  const maxPan = Math.max(0, sceneBounds.width - size.width);
  const panX = useSharedValue(0);
  const pan = Gesture.Pan()
    .enabled(maxPan > 0)
    .onChange((e) => {
      panX.value = Math.min(0, Math.max(-maxPan, panX.value + e.changeX));
    });
  // Clamped here (not in the gesture callback alone) so a shrinking `maxPan`
  // — the device rotating to landscape mid-use — can't leave the transform
  // showing a stale, now-out-of-range offset: `panX.value` itself might
  // briefly sit outside the new range until the next drag, but the DISPLAYED
  // transform never does. Writing `panX.value` from both an effect and this
  // gesture callback (the natural-looking alternative) is exactly what
  // React Compiler's `react-hooks/immutability` rule rejects for a shared
  // value, so the clamp lives only here instead.
  const panTransform = useDerivedValue(() => [
    { translateX: Math.min(0, Math.max(-maxPan, panX.value)) },
  ]);

  // Each mode composes only its OWN scene. Both used to be composed on every
  // layout regardless of `sceneArtMode`, which was cheap when the procedural
  // theme was 32 placements and isn't now that `scene/backdrop.ts` puts ~140
  // through it — and sprite mode is a `__DEV__`-gated A/B toggle that almost
  // no run ever enters.
  const scene = useMemo(
    () =>
      !plain && sceneArtMode === "procedural" && sceneBounds.width > 0 && sceneBounds.height > 0
        ? composeScene(NATURE_SCAPE, sceneBounds.width, sceneBounds.height, substrateY)
        : null,
    [plain, sceneArtMode, sceneBounds.width, sceneBounds.height, substrateY],
  );
  const piecesByLayer = useMemo(() => {
    const grouped: Record<SceneLayer, PlacedPiece[]> = {
      far: [],
      back: [],
      backMid: [],
      mid: [],
      frontMid: [],
      front: [],
      frontMost: [],
    };
    for (const piece of scene?.pieces ?? []) grouped[piece.layer].push(piece);
    return grouped;
  }, [scene]);

  const spriteScene = useMemo(() => {
    if (plain || sceneArtMode !== "sprites" || sceneBounds.width <= 0 || sceneBounds.height <= 0) {
      return null;
    }
    // No always-on background dressing — the tank shows exactly the user's
    // own placements (see `AquariumCanvas`'s `userScape` doc).
    return composeSpriteScene(
      userScape ?? EMPTY_SPRITE_SCAPE,
      sceneBounds.width,
      sceneBounds.height,
      substrateY,
    );
  }, [plain, sceneArtMode, sceneBounds.width, sceneBounds.height, substrateY, userScape]);
  const spritesByLayer = useMemo(() => {
    const grouped: Record<SceneLayer, PlacedSprite[]> = {
      far: [],
      back: [],
      backMid: [],
      mid: [],
      frontMid: [],
      front: [],
      frontMost: [],
    };
    for (const piece of spriteScene?.pieces ?? []) grouped[piece.layer].push(piece);
    return grouped;
  }, [spriteScene]);

  // The selected item's on-screen rect, for the Decorate screen's highlight
  // frame — found by `key` (== the decor row's own id, see
  // `compose-sprites.ts`'s `SpritePlacement.id` doc), not by scanning DOM/RN
  // refs, since the piece is drawn straight into the Skia scene graph with
  // no addressable view of its own.
  const highlightRect = useMemo(() => {
    if (!highlightId) return null;
    const piece = spriteScene?.pieces.find((p) => p.key === highlightId);
    if (!piece) return null;
    return {
      x: piece.worldX + piece.rect.x,
      y: piece.worldY + piece.rect.y,
      width: piece.rect.width,
      height: piece.rect.height,
    };
  }, [highlightId, spriteScene]);

  // Climbable decor, per band. Grouped by band on purpose: a snail is drawn
  // INSIDE its band's `ParallaxGroup`, so it can only be given stems from the
  // same group — anything else would be offset by the parallax delta and the
  // snail would climb thin water beside the plant.
  const climbByLayer = useMemo(() => {
    const grouped: Record<SceneLayer, ClimbProp[]> = {
      far: [],
      back: [],
      backMid: [],
      mid: [],
      frontMid: [],
      front: [],
      frontMost: [],
    };
    if (sceneArtMode === "sprites") {
      for (const piece of spriteScene?.pieces ?? []) {
        const prop = climbPropFrom(piece.worldX, piece.worldY, piece.worldY + piece.rect.y);
        if (prop) grouped[piece.layer].push(prop);
      }
    } else {
      for (const piece of scene?.pieces ?? []) {
        const prop = climbPropFrom(piece.worldX, piece.worldY, piece.worldY + piece.bbox.y);
        if (prop) grouped[piece.layer].push(prop);
      }
    }
    return grouped;
  }, [sceneArtMode, scene, spriteScene]);

  const cameraX = useCameraX();

  const renderDecor = (layer: SceneLayer) =>
    sceneArtMode === "sprites" ? (
      <SpriteLayerGroup pieces={spritesByLayer[layer]} />
    ) : (
      <SceneLayerGroup pieces={piecesByLayer[layer]} />
    );

  return (
    <GestureDetector gesture={pan}>
      <View
        style={[styles.root, style]}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          setSize({ width, height });
        }}
      >
        {size.width > 0 && size.height > 0 ? (
          <Canvas style={StyleSheet.absoluteFill}>
            <Group transform={panTransform}>
              {/* Real viewport height, NOT the fixed `sceneBounds` height, and
                  NOT inside the vertical-offset group below: water simply
                  fills however tall the actual screen is — the extra room a
                  portrait viewport has over this fixed-height scene reads as
                  more open water above the tank, never bigger decor. */}
              {sceneArtMode === "sprites" ? (
                <SpriteWater width={sceneBounds.width} height={size.height} />
              ) : (
                <AquariumWater width={sceneBounds.width} height={size.height} />
              )}
              {/* Bottom-anchors the fixed-size scene within a taller viewport
                  — see `verticalOffset`'s doc. Everything pixel-sized off
                  `sceneBounds` (sand, decor, fish, bubbles) lives in here so
                  none of it stretches; only its position shifts. */}
              <Group transform={[{ translateY: verticalOffset }]}>
                {!plain && (
                  <ParallaxGroup factor={PARALLAX_FACTOR.front} cameraX={cameraX}>
                    {sceneArtMode === "sprites" ? (
                      <SpriteSubstrate width={sceneBounds.width} height={sceneBounds.height} />
                    ) : (
                      <AquariumSubstrate width={sceneBounds.width} height={sceneBounds.height} />
                    )}
                  </ParallaxGroup>
                )}
                {!plain && (
                  <ParallaxGroup factor={PARALLAX_FACTOR.far} cameraX={cameraX}>
                    {renderDecor("far")}
                  </ParallaxGroup>
                )}
                {dead.map((f) => renderDead(f, sceneBounds))}
                {plain
                  ? alive.map((f) => renderAlive(f, sceneBounds, mode, shrinkToTankScale))
                  : FISH_LAYERS.map((layer) => (
                      <ParallaxGroup key={layer} factor={PARALLAX_FACTOR[layer]} cameraX={cameraX}>
                        {renderDecor(layer)}
                        {alive
                          .filter((f) => f.band === layer)
                          .map((f) =>
                            renderAlive(
                              f,
                              sceneBounds,
                              mode,
                              shrinkToTankScale,
                              climbByLayer[layer],
                            ),
                          )}
                      </ParallaxGroup>
                    ))}
                {!plain && (
                  <AquariumBubbles width={sceneBounds.width} height={sceneBounds.height} />
                )}
                {highlightRect ? (
                  <Rect
                    x={highlightRect.x - HIGHLIGHT_PAD}
                    y={highlightRect.y - HIGHLIGHT_PAD}
                    width={highlightRect.width + HIGHLIGHT_PAD * 2}
                    height={highlightRect.height + HIGHLIGHT_PAD * 2}
                    style="stroke"
                    strokeWidth={HIGHLIGHT_STROKE}
                    color={HIGHLIGHT_COLOR}
                  />
                ) : null}
              </Group>
            </Group>
          </Canvas>
        ) : null}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    overflow: "hidden",
  },
});
