// The aquarium renderer's iteration loop — no device needed, mirrors
// `yarn fish:preview`'s role for the old pipeline. Renders every colour at
// every life stage, plus every body/tail/dorsal combination, through the
// SAME emitter (`core/emit.ts`) and bake path (`fish/bake-fish.ts`) the app
// uses — via `scripts/lib/skia-node.ts`'s CanvasKit-backed Skia — so this
// gallery is pixel-exact evidence of what the app draws, not an
// approximation of it.

import fs from "node:fs";
import path from "node:path";

import { loadSkiaNode } from "./lib/skia-node";
import { bakeFish, densityAwareDpr } from "@/shared/aquarium/fish/bake-fish";
import { EYE_STYLE_IDS, type EyeStyleId } from "@/shared/aquarium/fish/eyes";
import { bakeNodes } from "@/shared/aquarium/core/bake";
import { bakeCreature } from "@/shared/aquarium/creatures/bake-creature";
import { bakeSnail } from "@/shared/aquarium/creatures/snail/bake-creature";
import { buildCrawlTrack, sampleTrack } from "@/shared/aquarium/sim/crawl";
import type { Box, Node } from "@/shared/aquarium/core/ir";
import type { SkCanvas } from "@shopify/react-native-skia/src/skia/types";
import { getSubstrateEffect, SUBSTRATE_UNIFORM_KEYS } from "@/shared/aquarium/core/sksl/substrate";
import { getWaterEffect, WATER_UNIFORM_KEYS } from "@/shared/aquarium/core/sksl/water";
import {
  getWarpEffect,
  RELIGHT_OFF_UNIFORMS,
  RELIGHT_STATIC_UNIFORMS,
  relightYaw,
  WARP_UNIFORM_KEYS,
} from "@/shared/aquarium/core/sksl/warp";
import {
  bakeBodyNormalMap,
  bakeNormalMap,
  NORMAL_PX_PER_UNIT,
} from "@/shared/aquarium/fish/normal-map";
import { axolotlVolume } from "@/shared/aquarium/creatures/axolotl/normal-map";
import { SPINE_AMP_MAX, SPINE_K, SPINE_PAD } from "@/shared/aquarium/fish/spine";
import { composeSpriteScene } from "@/shared/aquarium/scene/compose-sprites";
import { composeScene, GENERATORS } from "@/shared/aquarium/scene/compose";
import { DEFAULT_SCENE_DESIGN } from "@/shared/aquarium/scene/scene-design";
import { BLENDER_PIECES } from "@/shared/aquarium/scene/sprites/blender-manifest";
import { SCENE_SPRITES } from "@/shared/aquarium/scene/sprites/sprite-manifest";
import { BLENDER_SCAPE_FILLED } from "@/shared/aquarium/scene/themes/blender-scape";
import { SPRITE_SCAPE_FILLED } from "@/shared/aquarium/scene/themes/nature-scape-sprites";
import { NATURE_SCAPE } from "@/shared/aquarium/scene/themes/nature-scape";
import { SPECIES_LIST } from "@/shared/creature/catalog";
import type { SpeciesDef, SpeciesId } from "@/shared/creature/types";
import { COLOR_DEFS } from "@/shared/fish/catalog";
import { generateBreedRecipe, generatedColorId, strainCode } from "@/shared/fish/generated-breed";
import type { BodyId, DorsalId, FishTraits, LifeStage, TailId } from "@/shared/fish/types";
import { parseHex } from "@/shared/lib/color";
import { processTransform } from "@shopify/react-native-skia/src/skia/types/Matrix";
import type { Matrix4, Transforms3d } from "@shopify/react-native-skia/src/skia/types/Matrix4";
import {
  ClipOp,
  FilterMode,
  MipmapMode,
  TileMode,
} from "@shopify/react-native-skia/src/skia/types";

const OUT_PATH = path.join(__dirname, "..", "src", "docs", "aquarium-preview.html");
const STAGES: LifeStage[] = ["egg", "fry", "juvenile", "adult"];
const BODIES: BodyId[] = ["standard", "balloon"];
const TAILS: TailId[] = ["round", "lyretail"];
const DORSALS: DorsalId[] = ["standard", "sailfin"];

interface Cell {
  label: string;
  dataUri: string | null;
}

async function main() {
  const Skia = await loadSkiaNode();
  const dpr = densityAwareDpr(2, 1.2);

  const toDataUri = (
    traits: FishTraits,
    stage: LifeStage,
    eyeStyle?: EyeStyleId,
  ): string | null => {
    const baked = bakeFish(Skia, traits, stage, dpr, eyeStyle);
    if (!baked) return null;
    const bytes = baked.image.encodeToBytes();
    return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
  };

  console.log(`Baking ${COLOR_DEFS.length} colors x ${STAGES.length} stages...`);
  const colorRows = COLOR_DEFS.map((def) => {
    const cells: Cell[] = STAGES.map((stage) => ({
      label: stage,
      dataUri: toDataUri(
        { color: def.id, body: "standard", tail: "round", dorsal: "standard" },
        stage,
      ),
    }));
    return { name: def.name, id: def.id, rarity: def.rarity.tier, cells };
  });

  console.log("Baking all 8 body/tail/dorsal combinations...");
  const anatomyCells: Cell[] = [];
  for (const body of BODIES) {
    for (const tail of TAILS) {
      for (const dorsal of DORSALS) {
        anatomyCells.push({
          label: `${body}/${tail}/${dorsal}`,
          dataUri: toDataUri({ color: "goldDust", body, tail, dorsal }, "adult"),
        });
      }
    }
  }

  // Eye styles: one cell per style, on a plain palette and a heavily
  // patterned one. The app picks a style per fish from its own seed, so this
  // grid uses `bakeFish`'s tooling-only override to lay them out side by
  // side — otherwise a given colour only ever shows the one style its seed
  // bucket happens to land on. Rendered large (see `.eye-cell`): the eye is
  // ~6px of a ~200px fish and is invisible at the default cell width.
  console.log(`Baking ${EYE_STYLE_IDS.length} eye styles...`);
  const eyeRows = (["goldDust", "sanke"] as const).map((color) => ({
    name: color,
    cells: EYE_STYLE_IDS.map((style): Cell => ({
      label: style,
      dataUri: toDataUri(
        { color, body: "standard", tail: "round", dorsal: "standard" },
        "adult",
        style,
      ),
    })),
  }));

  // Yaw strip: the baked fish through fish-layer.tsx's exact perspective
  // matrix at 9 yaw values, so `EDGE_ON_MIN_WIDTH`/`PERSPECTIVE_RATIO` are
  // tunable without a device — there is no device in this environment. Uses
  // `processTransform` from react-native-skia's own `Matrix.ts` (the same
  // function `<Group transform>` calls at runtime) against a real
  // `SkCanvas`, not a reimplementation, so this is the actual conversion
  // path, not an approximation of it.
  console.log("Rendering yaw strip...");
  const EDGE_ON_MIN_WIDTH = 0.3; // must match fish-layer.tsx
  const PERSPECTIVE_RATIO = 2.2; // must match fish-layer.tsx
  const YAW_STEPS = 9;
  const yawBaked = bakeFish(
    Skia,
    { color: "goldDust", body: "standard", tail: "round", dorsal: "standard" },
    "adult",
    dpr,
  );
  const yawCells: { label: string; dataUri: string | null }[] = [];
  if (yawBaked) {
    const CELL = 170;
    const renderScale = 1;
    const imageRect = Skia.XYWHRect(
      yawBaked.bounds.x,
      yawBaked.bounds.y,
      yawBaked.bounds.width,
      yawBaked.bounds.height,
    );
    for (let i = 0; i < YAW_STEPS; i++) {
      const yaw = -Math.PI + (i / (YAW_STEPS - 1)) * 2 * Math.PI;
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      const w = -(c >= 0 ? 1 : -1) * Math.max(Math.abs(c), EDGE_ON_MIN_WIDTH);
      const q = s / (PERSPECTIVE_RATIO * yawBaked.bounds.width * renderScale);
      const matrix: Matrix4 = [w, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, q, 0, 0, 1];
      const transforms: Transforms3d = [
        { translateX: CELL / 2 },
        { translateY: CELL / 2 },
        { rotate: 0 },
        { matrix },
        { scaleX: renderScale },
        { scaleY: renderScale },
      ];

      const surf = Skia.Surface.Make(CELL, CELL)!;
      const canvas = surf.getCanvas();
      const bg = Skia.Paint();
      bg.setColor(Skia.Color("#c9e6f2"));
      canvas.drawRect(Skia.XYWHRect(0, 0, CELL, CELL), bg);
      const guide = Skia.Paint();
      guide.setColor(Skia.Color("#00000033"));
      canvas.drawRect(Skia.XYWHRect(CELL / 2 - 0.5, 0, 1, CELL), guide);

      canvas.save();
      processTransform(canvas, transforms);
      // `drawImage` draws at the image's native (dpr-scaled) pixel size —
      // `drawImageRect` into the baked LOGICAL bounds is what actually
      // matches fish-layer.tsx's `<SkiaImage rect={imageRect} fit="fill">`.
      const srcRect = Skia.XYWHRect(0, 0, yawBaked.image.width(), yawBaked.image.height());
      const imgPaint = Skia.Paint();
      canvas.drawImageRect(yawBaked.image, srcRect, imageRect, imgPaint);
      canvas.restore();

      const bytes = surf.makeImageSnapshot().encodeToBytes();
      const dataUri = `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
      const deg = Math.round((yaw * 180) / Math.PI);
      yawCells.push({
        label: `yaw ${deg}° (w=${w.toFixed(2)} q=${(q * yawBaked.bounds.width).toFixed(2)})`,
        dataUri,
      });
    }
  }

  // Relight strips: the ONLY way to judge `fish/normal-map.ts` +
  // `core/sksl/warp.ts`'s relight pass without a device. Everything here goes
  // through the real compiled SkSL with the real normal map, at the same
  // uniforms `render/fish-layer.tsx` feeds it — the point being that the two
  // things a baked-in highlight cannot do (respond to the body bending,
  // respond to the fish turning) are exactly the two things these strips
  // isolate. Each cell is a matched OFF|ON pair so the difference is legible
  // rather than remembered.
  console.log("Rendering relight strips...");
  const relightTraits: FishTraits = {
    color: "goldDust",
    body: "standard",
    tail: "round",
    dorsal: "standard",
  };
  const relightAlbedo = bakeFish(Skia, relightTraits, "adult", dpr);
  const relightNormal = bakeBodyNormalMap(Skia, relightTraits, "adult");
  const relightEffect = getWarpEffect(Skia);

  /** One fish drawn through the warp+relight shader into a `size`-square tile. */
  const drawRelit = (
    canvas: SkCanvas,
    originX: number,
    size: number,
    phase: number,
    yaw: number,
    on: boolean,
  ): void => {
    if (!relightAlbedo || !relightEffect) return;
    // Image-space -> local-space for each child: the albedo is baked at `dpr`
    // px per unit over its own bounds, the normal map at NORMAL_PX_PER_UNIT
    // over its (smaller) box. Getting these two matrices right is the whole
    // registration story — on device `<ImageShader rect=...>` does it, here
    // it has to be spelled out.
    const albedoMatrix = Skia.Matrix();
    albedoMatrix.translate(relightAlbedo.bounds.x, relightAlbedo.bounds.y);
    albedoMatrix.scale(1 / dpr, 1 / dpr);
    const albedoShader = relightAlbedo.image.makeShaderOptions(
      TileMode.Decal,
      TileMode.Decal,
      FilterMode.Linear,
      MipmapMode.None,
      albedoMatrix,
    );
    const normalArt = relightNormal ?? relightAlbedo;
    const normalMatrix = Skia.Matrix();
    normalMatrix.translate(normalArt.bounds.x, normalArt.bounds.y);
    const nUnit = relightNormal ? 1 / NORMAL_PX_PER_UNIT : 1 / dpr;
    normalMatrix.scale(nUnit, nUnit);
    const normalShader = normalArt.image.makeShaderOptions(
      TileMode.Decal,
      TileMode.Decal,
      FilterMode.Linear,
      MipmapMode.None,
      normalMatrix,
    );

    const uniforms: Record<string, number | number[]> = {
      boundsX: relightAlbedo.bounds.x,
      boundsWidth: relightAlbedo.bounds.width,
      ampScale: SPINE_AMP_MAX,
      k: SPINE_K,
      phase,
      bendAmp: 0,
      // Fin secondary rotation off: this strip is about LIGHT, and three
      // extra moving fins would only make the comparison harder to read.
      pecNearHub: [0, 0, 1, 1],
      pecFarHub: [0, 0, 1, 1],
      caudalHub: [0, 0, 1, 1],
      pecNearAmp: 0,
      pecFarAmp: 0,
      caudalAmp: 0,
      ...(on ? RELIGHT_STATIC_UNIFORMS : RELIGHT_OFF_UNIFORMS),
      ...(on ? relightYaw(yaw) : { yawCos: 1, yawSin: 0 }),
    };
    const shader = relightEffect.makeShaderWithChildren(
      WARP_UNIFORM_KEYS.flatMap((key) => uniforms[key]),
      [albedoShader, normalShader],
    );

    // The same mirror/foreshorten matrix fish-layer.tsx applies, so a cell
    // shows the fish at the heading its lighting was computed for.
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const w = -(c >= 0 ? 1 : -1) * Math.max(Math.abs(c), EDGE_ON_MIN_WIDTH);
    const q = s / (PERSPECTIVE_RATIO * relightAlbedo.bounds.width);
    const matrix: Matrix4 = [w, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, q, 0, 0, 1];

    canvas.save();
    processTransform(canvas, [
      { translateX: originX + size / 2 },
      { translateY: size / 2 },
      { matrix },
    ] as Transforms3d);
    const paint = Skia.Paint();
    paint.setShader(shader);
    canvas.drawRect(
      Skia.XYWHRect(
        relightAlbedo.bounds.x - SPINE_PAD,
        relightAlbedo.bounds.y - SPINE_PAD,
        relightAlbedo.bounds.width + SPINE_PAD * 2,
        relightAlbedo.bounds.height + SPINE_PAD * 2,
      ),
      paint,
    );
    canvas.restore();
  };

  /** An OFF|ON pair in one PNG, with a hairline between the halves. */
  const relightPair = (label: string, phase: number, yaw: number): Cell => {
    const S = 150;
    const surf = Skia.Surface.Make(S * 2, S);
    if (!surf) return { label, dataUri: null };
    const canvas = surf.getCanvas();
    const bg = Skia.Paint();
    bg.setColor(Skia.Color("#c9e6f2"));
    canvas.drawRect(Skia.XYWHRect(0, 0, S * 2, S), bg);
    drawRelit(canvas, 0, S, phase, yaw, false);
    drawRelit(canvas, S, S, phase, yaw, true);
    const divider = Skia.Paint();
    divider.setColor(Skia.Color("#00000044"));
    canvas.drawRect(Skia.XYWHRect(S - 0.5, 0, 1, S), divider);
    const bytes = surf.makeImageSnapshot().encodeToBytes();
    return { label, dataUri: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}` };
  };

  // Turning the fish. This is the strip that answers "does yaw do anything?"
  const relightYawCells: Cell[] = [];
  for (let i = 0; i < 5; i++) {
    const deg = i * 45;
    const yaw = (deg * Math.PI) / 180;
    relightYawCells.push(relightPair(`yaw ${deg}°  (off | on)`, 0, yaw));
  }

  // Bending the fish. Same heading, one full tail beat — the highlight
  // should travel along the flank rather than sit still.
  const relightBendCells: Cell[] = [];
  for (let i = 0; i < 5; i++) {
    const phase = (i / 5) * Math.PI * 2;
    relightBendCells.push(relightPair(`beat ${Math.round((i / 5) * 360)}°  (off | on)`, phase, 0));
  }

  // The raw maps, viewed directly: R = normal x, G = normal y, B = body mask.
  // A malformed map is far easier to spot here than in its effect on a lit
  // fish — a hole in the mask, a discontinuity at the peduncle, a channel
  // stuck at a constant all read at a glance.
  const normalMapCells: Cell[] = [];
  const pngCell = (
    label: string,
    art: { image: { encodeToBytes(): Uint8Array } } | null,
  ): Cell => ({
    label,
    dataUri: art
      ? `data:image/png;base64,${Buffer.from(art.image.encodeToBytes()).toString("base64")}`
      : null,
  });
  // The axolotl is the only non-molly species with a volume — and the only
  // one whose profile FLARES at u=1 (a paddle tail), so its mask must stay
  // solid all the way to the tail tip where a molly's fades out. That
  // difference is the thing to look for here.
  normalMapCells.push(
    pngCell("axolotl (paddle tail, no feather)", bakeNormalMap(Skia, axolotlVolume())),
  );
  for (const body of BODIES) {
    for (const stage of ["fry", "juvenile", "adult"] as LifeStage[]) {
      const art = bakeBodyNormalMap(Skia, { ...relightTraits, body }, stage);
      normalMapCells.push({
        label: `${body} / ${stage}`,
        dataUri: art
          ? `data:image/png;base64,${Buffer.from(art.image.encodeToBytes()).toString("base64")}`
          : null,
      });
    }
  }

  // Full-scene composite: the nature-scape theme's decor, drawn at real
  // placed positions via the same `bakeNodes`/`emit` path
  // `render/decor-cache.ts` and `verify-aquarium.ts`'s column-occupancy
  // check use — the only way to actually judge composition (layout,
  // asymmetry, decor size relative to the tank) without a device.
  console.log("Rendering full-scene composites...");
  // These used to be hand-copied literals that had already drifted from the
  // real render/water.tsx — reading from scene-design.ts is what keeps this
  // composite pixel-matched to the app going forward.
  const SUBSTRATE_TOP = DEFAULT_SCENE_DESIGN.substrate.top;
  const SUBSTRATE_BOTTOM = DEFAULT_SCENE_DESIGN.substrate.bottom;
  const WATER_TOP = DEFAULT_SCENE_DESIGN.water.top;
  const WATER_BOTTOM = DEFAULT_SCENE_DESIGN.water.bottom;
  const toUnit = (hex: string): [number, number, number] => {
    const rgb = parseHex(hex) ?? [0, 0, 0];
    return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
  };
  const substrateEffect = getSubstrateEffect(Skia);
  const sceneCells: { label: string; dataUri: string | null }[] = [];
  for (const [w, h] of [
    [390, 844],
    [844, 390],
  ] as const) {
    const substrateY = h - 60;
    const scene = composeScene(NATURE_SCAPE, w, h, substrateY);
    const decorNodes: Node[] = scene.pieces.map((piece) => {
      const attachTo =
        piece.attachAngleDeg !== undefined
          ? { x: 0, y: 0, angleDeg: piece.attachAngleDeg }
          : undefined;
      const generated = GENERATORS[piece.species]({
        seed: piece.seed,
        scale: piece.scale,
        attachTo,
        mirror: piece.mirror,
      });
      return {
        kind: "group" as const,
        children: generated.nodes,
        transform: { translateX: piece.worldX, translateY: piece.worldY },
      };
    });

    const surf = Skia.Surface.Make(w, h)!;
    const canvas = surf.getCanvas();
    const waterPaint = Skia.Paint();
    waterPaint.setShader(
      Skia.Shader.MakeLinearGradient(
        Skia.Point(0, 0),
        Skia.Point(0, h),
        [Skia.Color(WATER_TOP), Skia.Color(WATER_BOTTOM)],
        [0, 1],
        TileMode.Clamp,
      ),
    );
    canvas.drawRect(Skia.XYWHRect(0, 0, w, h), waterPaint);
    const sandHeight = h - substrateY;
    if (substrateEffect) {
      const uniforms = {
        width: w,
        height: sandHeight,
        colorTop: toUnit(SUBSTRATE_TOP),
        colorBottom: toUnit(SUBSTRATE_BOTTOM),
        speckleColor: toUnit(DEFAULT_SCENE_DESIGN.substrate.speckleColor),
        grainStrength: DEFAULT_SCENE_DESIGN.substrate.grainStrength,
        speckleDensity: DEFAULT_SCENE_DESIGN.substrate.speckleDensity,
      };
      const sandPaint = Skia.Paint();
      sandPaint.setShader(
        substrateEffect.makeShader(SUBSTRATE_UNIFORM_KEYS.flatMap((key) => uniforms[key])),
      );
      canvas.save();
      canvas.translate(0, substrateY);
      canvas.drawRect(Skia.XYWHRect(0, 0, w, sandHeight), sandPaint);
      canvas.restore();
    } else {
      const sandPaint = Skia.Paint();
      sandPaint.setShader(
        Skia.Shader.MakeLinearGradient(
          Skia.Point(0, substrateY),
          Skia.Point(0, h),
          [Skia.Color(SUBSTRATE_TOP), Skia.Color(SUBSTRATE_BOTTOM)],
          [0, 1],
          TileMode.Clamp,
        ),
      );
      canvas.drawRect(Skia.XYWHRect(0, substrateY, w, h - substrateY), sandPaint);
    }

    const bounds: Box = { x: 0, y: 0, width: w, height: substrateY };
    const baked = bakeNodes(Skia, decorNodes, bounds, 1);
    if (baked) {
      const srcRect = Skia.XYWHRect(0, 0, baked.image.width(), baked.image.height());
      const destRect = Skia.XYWHRect(bounds.x, bounds.y, bounds.width, bounds.height);
      canvas.drawImageRect(baked.image, srcRect, destRect, Skia.Paint());
    }
    // Swim lane guides, so the corridor the theme authored is visible.
    for (const lane of scene.swimLaneRects) {
      const laneGuide = Skia.Paint();
      laneGuide.setColor(Skia.Color("#ffffff33"));
      canvas.drawRect(Skia.XYWHRect(lane.x, 0, 1, h), laneGuide);
      canvas.drawRect(Skia.XYWHRect(lane.x + lane.width, 0, 1, h), laneGuide);
    }

    const bytes = surf.makeImageSnapshot().encodeToBytes();
    sceneCells.push({
      label: `${w}x${h} — ${scene.pieces.length} pieces`,
      dataUri: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`,
    });
  }

  // Sprite-mode composite — approach "B" in the procedural-vs-sprite A/B
  // comparison, drawn from disk (not through the app's `require`/Metro
  // resolution) so this stays runnable from plain Node. Degrades to a
  // labelled empty cell per canvas size until real PNGs are supplied — see
  // `sprite-manifest.ts`'s header.
  console.log("Rendering sprite-scape composites...");
  // Same reference-sampled palette as `render/sprite-layers.tsx`'s
  // `SpriteWater` — duplicated for the same "sprite mode has no dependency
  // on the other render module" reason as that file's LAYER_OPACITY note.
  const SPRITE_WATER_TOP = "#7fc4dc";
  const SPRITE_WATER_MID = "#3f93b4";
  const SPRITE_WATER_BOTTOM = "#123f56";
  // Per-layer atmospheric perspective, from the SAME `scene-design.ts` values
  // the device renderer reads. This loop previously drew every piece with a
  // bare paint, so the preview showed no depth falloff whatsoever and could
  // not be used to judge it — which is exactly the thing that needed judging.
  const L = DEFAULT_SCENE_DESIGN.layers;
  const LAYER_ALPHA: Record<string, number> = {
    far: L.opacityFar,
    back: L.opacityBack,
    backMid: L.opacityBackMid,
    mid: L.opacityMid,
    frontMid: L.opacityFrontMid,
    front: L.opacityFront,
    frontMost: L.opacityFrontMost,
  };
  const LAYER_HAZE: Record<string, number> = {
    far: L.hazeFar,
    back: L.hazeBack,
    backMid: L.hazeBackMid,
    mid: L.hazeMid,
    frontMid: L.hazeFrontMid,
    front: 0,
    frontMost: 0,
  };
  const unit = (hex: string) => (parseHex(hex) ?? [0, 0, 0]).map((c) => c / 255);
  const hazeUnit = unit(L.hazeColor);
  const spritePaintFor = (layer: string) => {
    const paint = Skia.Paint();
    paint.setAlphaf(1 - (1 - (LAYER_ALPHA[layer] ?? 1)) * L.hazeOpacityRelief);
    const k = LAYER_HAZE[layer] ?? 0;
    if (k > 0) {
      const inv = 1 - k;
      paint.setColorFilter(
        Skia.ColorFilter.MakeMatrix([
          inv, 0, 0, 0, hazeUnit[0] * k,
          0, inv, 0, 0, hazeUnit[1] * k,
          0, 0, inv, 0, hazeUnit[2] * k,
          0, 0, 0, 1, 0,
        ]),
      );
    }
    return paint;
  };
  const spriteSceneCells: { label: string; dataUri: string | null }[] = [];
  const blenderSceneCells: { label: string; dataUri: string | null }[] = [];
  for (const [themeCells, theme] of [
    [spriteSceneCells, SPRITE_SCAPE_FILLED],
    [blenderSceneCells, BLENDER_SCAPE_FILLED],
  ] as const)
    for (const [w, h] of [
      [390, 844],
      [844, 390],
    ] as const) {
      const substrateY = h - 60;
      const spriteScene = composeSpriteScene(theme, w, h, substrateY);
      if (spriteScene.pieces.length === 0) {
        themeCells.push({
          label: `${w}x${h} — no sprite assets supplied`,
          dataUri: null,
        });
        continue;
      }
      const surf = Skia.Surface.Make(w, h)!;
      const canvas = surf.getCanvas();
      const waterPaint = Skia.Paint();
      // The real water shader, not a linear gradient. The god-ray shafts are
      // the only thing in frame that states a light DIRECTION, so a preview
      // that flattens them to a gradient cannot be used to judge the one
      // complaint they exist to answer. Falls back to the gradient if the
      // effect will not compile, same contract as `render/water.tsx`.
      const waterEffect = getWaterEffect(Skia);
      const waterUniforms: Record<string, number | number[]> = {
        width: w,
        height: h,
        time: 0,
        colorTop: unit(SPRITE_WATER_TOP),
        colorMid: unit(SPRITE_WATER_MID),
        colorBottom: unit(SPRITE_WATER_BOTTOM),
      };
      waterPaint.setShader(
        waterEffect
          ? waterEffect.makeShader(WATER_UNIFORM_KEYS.flatMap((k) => waterUniforms[k]))
          : Skia.Shader.MakeLinearGradient(
          Skia.Point(0, 0),
          Skia.Point(0, h),
          [
            Skia.Color(SPRITE_WATER_TOP),
            Skia.Color(SPRITE_WATER_MID),
            Skia.Color(SPRITE_WATER_BOTTOM),
          ],
          [0, 0.55, 1],
          TileMode.Clamp,
        ),
      );
      canvas.drawRect(Skia.XYWHRect(0, 0, w, h), waterPaint);
      // Sprite mode's ground is the SAME procedural substrate shader the 2D
      // theme uses, only with a warmer/lighter palette, and clipped to a wavy
      // top edge. Keep all of this in sync with `render/sprite-layers.tsx`'s
      // SPRITE_SAND_* / SAND_SEAM_* / SAND_WAVE_MAX constants. It used to
      // stretch `sand-patch.png` edge to edge; see that file's
      // `SpriteSubstrate` doc for why that had to go.
      const spriteSandHeight = h - substrateY;
      const SAND_WAVE_MAX = 5;
      const waveAmp = Math.min(SAND_WAVE_MAX, spriteSandHeight * 0.14);
      const sandPath = Skia.Path.Make();
      sandPath.moveTo(0, h);
      const WAVE_STEPS = 64;
      for (let i = 0; i <= WAVE_STEPS; i++) {
        const t = i / WAVE_STEPS;
        const wave = Math.sin(t * Math.PI * 3.1) * 0.6 + Math.sin(t * Math.PI * 7.7 + 1.7) * 0.4;
        sandPath.lineTo(w * t, substrateY + wave * waveAmp);
      }
      sandPath.lineTo(w, h);
      sandPath.close();

      canvas.save();
      canvas.clipPath(sandPath, ClipOp.Intersect, true);
      if (substrateEffect) {
        const spriteUniforms: Record<string, number | number[]> = {
          width: w,
          height: spriteSandHeight,
          colorTop: [0.906, 0.843, 0.702],
          colorBottom: [0.757, 0.663, 0.51],
          speckleColor: [0.494, 0.416, 0.298],
          grainStrength: 0.055,
          speckleDensity: 0.14,
        };
        const spriteSandPaint = Skia.Paint();
        spriteSandPaint.setShader(
          substrateEffect.makeShader(SUBSTRATE_UNIFORM_KEYS.flatMap((key) => spriteUniforms[key])),
        );
        canvas.save();
        canvas.translate(0, substrateY - SAND_WAVE_MAX);
        canvas.drawRect(Skia.XYWHRect(0, 0, w, spriteSandHeight + SAND_WAVE_MAX), spriteSandPaint);
        canvas.restore();
      }
      // Sand/water seam shadow — mirrors SAND_SEAM_SHADOW/SAND_SEAM_FRACTION.
      const seamPaint = Skia.Paint();
      seamPaint.setShader(
        Skia.Shader.MakeLinearGradient(
          Skia.Point(0, substrateY - SAND_WAVE_MAX),
          Skia.Point(0, substrateY + spriteSandHeight * 0.42),
          [Skia.Color("rgba(52, 74, 84, 0.34)"), Skia.Color("rgba(52, 74, 84, 0)")],
          [0, 1],
          TileMode.Clamp,
        ),
      );
      canvas.drawRect(
        Skia.XYWHRect(0, substrateY - SAND_WAVE_MAX, w, spriteSandHeight * 0.42 + SAND_WAVE_MAX),
        seamPaint,
      );
      canvas.restore();
      for (const piece of spriteScene.pieces) {
        const sprite = SCENE_SPRITES[piece.spriteId];
        const pngPath = path.join(__dirname, "..", sprite.file);
        if (!fs.existsSync(pngPath)) continue;
        const bytes = fs.readFileSync(pngPath);
        const image = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(bytes));
        if (!image) continue;
        const srcRect = Skia.XYWHRect(0, 0, image.width(), image.height());
        const destRect = Skia.XYWHRect(
          piece.worldX + piece.rect.x,
          piece.worldY + piece.rect.y,
          piece.rect.width,
          piece.rect.height,
        );
        canvas.drawImageRect(image, srcRect, destRect, spritePaintFor(piece.layer));
      }
      const bytes = surf.makeImageSnapshot().encodeToBytes();
      themeCells.push({
        label: `${w}x${h} — ${spriteScene.pieces.length} pieces`,
        dataUri: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`,
      });
    }

  // Three-way decor comparison — the whole point of the Blender pipeline,
  // and the only place all three approaches to the same species sit next to
  // each other at the same size:
  //
  //   A  `scene/gen/*.ts`     Skia paths, infinitely variable, flat-lit
  //   B  `assets/.../scene/`  painted PNG, best looking, fixed resolution
  //   C  `assets/.../scene3d/` orthographic render of real 3D geometry
  //
  // Read C against A for whether the fold/venation/transmission work bought
  // anything, and against B for whether it is close enough to retire the
  // fixed-resolution art. Missing C files degrade to a labelled empty cell —
  // they are produced by `yarn decor:blender`, which needs Blender installed
  // and is deliberately not a prerequisite of this script.
  console.log("Rendering decor A/B/C comparison...");
  const decorRows: { name: string; cells: { label: string; dataUri: string | null }[] }[] = [];
  const pngDataUri = (repoRelative: string): string | null => {
    const abs = path.join(__dirname, "..", repoRelative);
    if (!fs.existsSync(abs)) return null;
    return `data:image/png;base64,${fs.readFileSync(abs).toString("base64")}`;
  };
  for (const [id, piece] of Object.entries(BLENDER_PIECES)) {
    const cells: { label: string; dataUri: string | null }[] = [];

    if (piece.generatedSpecies) {
      // Same seed the Blender render used, so the two are the same roll of
      // the same species rather than two unrelated individuals.
      const generated = GENERATORS[piece.generatedSpecies]({ seed: 3, scale: 1 });
      const pad = 8;
      const box: Box = {
        x: generated.bbox.x - pad,
        y: generated.bbox.y - pad,
        width: generated.bbox.width + pad * 2,
        height: generated.bbox.height + pad * 2,
      };
      const baked = bakeNodes(Skia, generated.nodes, box, 2);
      cells.push({
        label: `A · gen/${piece.generatedSpecies}.ts`,
        dataUri: baked
          ? `data:image/png;base64,${Buffer.from(baked.image.encodeToBytes()).toString("base64")}`
          : null,
      });
    }

    if (piece.paintedSpriteId) {
      const painted = SCENE_SPRITES[piece.paintedSpriteId];
      cells.push({
        label: `B · ${piece.paintedSpriteId} (painted)`,
        dataUri: painted ? pngDataUri(painted.file) : null,
      });
    }

    cells.push({ label: "C · blender (lit)", dataUri: pngDataUri(piece.file) });
    if (piece.normal) {
      cells.push({ label: "C · normal", dataUri: pngDataUri(piece.normal) });
    }
    decorRows.push({ name: id, cells });
  }

  // Creatures — every non-molly species x its own variant list, through
  // `creatures/bake-creature.ts`'s dispatcher: real anatomy where it's
  // shipped, the placeholder blob otherwise, so this section grows in
  // fidelity automatically as each species lands (Phase C) with no further
  // change to this script.
  console.log("Baking creatures...");
  const creatureDpr = densityAwareDpr(2, 1.2);
  const isCreatureDef = (
    def: SpeciesDef,
  ): def is SpeciesDef & { id: Exclude<SpeciesId, "molly"> } => def.id !== "molly";
  const creatureRows = SPECIES_LIST.filter(isCreatureDef).map((def) => {
    const cells: Cell[] = def.variants.map((variant) => {
      const baked = bakeCreature(Skia, def.id, variant.id, creatureDpr);
      if (!baked) return { label: variant.name, dataUri: null };
      const bytes = baked.image.encodeToBytes();
      return {
        label: variant.name,
        dataUri: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`,
      };
    });
    return { name: def.name, id: def.id, rarity: def.rarity.tier, cells };
  });

  // The snail's crawl track, with the snail placed along it. This is the
  // whole iteration surface for surface-bound locomotion: whether the sole
  // actually lies on the substrate, on both panes of glass, around the
  // corners and up BOTH faces of a plant stem is a thing you can only judge
  // by looking, and it is exactly what silently breaks if the art's local
  // frame (`creatures/snail/anatomy.ts`) and the placement transform
  // (`render/creature-layer.tsx`) ever disagree about which way is down.
  console.log("Baking the snail crawl strip...");
  const crawlCells: Cell[] = [];
  {
    const w = 420;
    const h = 560;
    const sandH = 64;
    const snailDpr = densityAwareDpr(2, 1.2);
    const body = bakeSnail(Skia, "garden", snailDpr, "body");
    const tentacles = bakeSnail(Skia, "garden", snailDpr, "tentacles");
    const box = { minX: 6, maxX: w - 6, floorY: h - sandH + 3, ceilY: h * 0.24 };
    const props = [{ x: 148, baseY: h - sandH + 3, topY: h - sandH + 3 - 230 }];
    const track = buildCrawlTrack(box, 0.42, props);

    const surf = Skia.Surface.Make(w * 2, h * 2);
    if (surf && body && tentacles) {
      const canvas = surf.getCanvas();
      canvas.clear(Skia.Color("#0f2f3d"));
      canvas.scale(2, 2);

      const sandPaint = Skia.Paint();
      sandPaint.setColor(Skia.Color("#3b3428"));
      canvas.drawRect(Skia.XYWHRect(0, h - sandH, w, sandH), sandPaint);
      const stemPaint = Skia.Paint();
      stemPaint.setColor(Skia.Color("#2f5a34"));
      canvas.drawRect(Skia.XYWHRect(145, h - sandH + 3 - 250, 6, 250), stemPaint);

      const paint = Skia.Paint();
      const steps = 13;
      for (let i = 0; i <= steps; i++) {
        const { x, y, angle } = sampleTrack(track, (i / steps) * track.total);
        canvas.save();
        canvas.translate(x, y);
        canvas.rotate((angle * 180) / Math.PI, 0, 0);
        canvas.scale(0.6, 0.6);
        for (const part of [tentacles, body]) {
          canvas.drawImageRect(
            part.image,
            Skia.XYWHRect(0, 0, part.image.width(), part.image.height()),
            Skia.XYWHRect(part.bounds.x, part.bounds.y, part.bounds.width, part.bounds.height),
            paint,
          );
        }
        canvas.restore();
      }
      const bytes = surf.makeImageSnapshot().encodeToBytes();
      crawlCells.push({
        label: `${track.segs.length} surfaces — substrate, both panes, one stem`,
        dataUri: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`,
      });
    }
  }

  // Procedurally generated breeds (`shared/fish/generated-breed.ts`). This is
  // the art-judgement surface for the generator: 60 breeds at a glance is
  // where a bad hue band, a washed-out palette or a runaway pattern parameter
  // becomes obvious, without a device or a build.
  //
  // Seeds come from a fixed multiplicative stride, NOT Math.random() — a
  // random gallery churns the entire HTML on every run, which makes the diff
  // useless for spotting what a tuning change actually did.
  console.log("Baking 60 generated breeds...");
  const genSeed = (i: number) => ((i + 1) * 2654435761) >>> 0;
  const genDataUri = (seed: number, stage: LifeStage, patternSeed = 0) =>
    toDataUri(
      {
        color: generatedColorId(seed),
        body: "standard",
        tail: "round",
        dorsal: "standard",
        patternSeed,
      },
      stage,
    );

  const genCells: Cell[] = Array.from({ length: 60 }, (_, i) => {
    const seed = genSeed(i);
    const recipe = generateBreedRecipe(seed);
    return {
      label: `${recipe.name} · ${strainCode(seed)} · ${recipe.pattern.type} · ${recipe.rarity.tier}`,
      dataUri: genDataUri(seed, "adult"),
    };
  });

  // Grouped by pattern type as well: judging `bands` against `bands` is much
  // faster at spotting a bad parameter range than judging it against a wall
  // of mixed patterns.
  const GEN_GROUP_SAMPLE = 300;
  const genByType = new Map<string, Cell[]>();
  for (let i = 0; i < GEN_GROUP_SAMPLE && genByType.size <= 7; i++) {
    const seed = genSeed(i);
    const recipe = generateBreedRecipe(seed);
    const bucket = genByType.get(recipe.pattern.type) ?? [];
    if (bucket.length >= 6) continue;
    bucket.push({
      label: `${recipe.name} · ${strainCode(seed)}`,
      dataUri: genDataUri(seed, "adult"),
    });
    genByType.set(recipe.pattern.type, bucket);
  }
  const genTypeRows = [...genByType.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, cells]) => ({ name: type, id: type, rarity: `${cells.length} shown`, cells }));

  // One breed through the two axes that aren't its own identity — life stage
  // (the squish factors) and `patternSeed` (the 8 per-individual jitter
  // buckets). The second one is the check that intra-breed variation exists
  // but doesn't destroy the breed's identity.
  const showcaseSeed = genSeed(3);
  const showcaseRecipe = generateBreedRecipe(showcaseSeed);
  const genStageCells: Cell[] = STAGES.map((stage) => ({
    label: stage,
    dataUri: genDataUri(showcaseSeed, stage),
  }));
  const genVariantCells: Cell[] = Array.from({ length: 8 }, (_, i) => ({
    label: `patternSeed ${i}`,
    dataUri: genDataUri(showcaseSeed, "adult", i),
  }));

  const cellHtml = (c: Cell) =>
    `<div class="cell"><div class="label">${c.label}</div>${
      c.dataUri
        ? `<img src="${c.dataUri}" alt="${c.label}" />`
        : `<div class="fail">bake failed</div>`
    }</div>`;

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Aquarium fish preview</title>
<style>
  body { font-family: -apple-system, sans-serif; background: #0a1b29; color: #eef3f7; padding: 24px; }
  h1 { font-size: 20px; } h2 { font-size: 15px; margin-top: 32px; color: #9fd0e6; }
  .row { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; padding: 8px; background: #123a4d; border-radius: 8px; }
  .row .name { width: 160px; flex-shrink: 0; } .row .rarity { width: 90px; flex-shrink: 0; font-size: 11px; opacity: 0.7; }
  .cells { display: flex; gap: 8px; flex-wrap: wrap; }
  .cell { text-align: center; } .cell img { display: block; background: #c9e6f2; border-radius: 6px; width: 110px; }
  .label { font-size: 10px; opacity: 0.7; margin-bottom: 2px; }
  .fail { width: 110px; height: 70px; background: #611; display: flex; align-items: center; justify-content: center; font-size: 10px; }
  .grid { display: flex; flex-wrap: wrap; gap: 12px; }
  .yaw-cell img { width: 170px; }
  .relight-cell img { width: 300px; image-rendering: auto; }
  .scene-cell img { width: 320px; background: none; }
  .eye-cell img { width: 300px; }
  .decor-cell img { width: 190px; background: #2f7b86; }
</style></head><body>
<h1>Aquarium fish preview</h1>
<p>Generated by <code>yarn aquarium:preview</code> from the exact code the app runs (real Skia, via scripts/lib/skia-node.ts).</p>
<h2>All 16 colors x life stages</h2>
${colorRows
  .map(
    (r) =>
      `<div class="row"><div class="name">${r.name}</div><div class="rarity">${r.rarity}</div><div class="cells">${r.cells.map(cellHtml).join("")}</div></div>`,
  )
  .join("\n")}
<h2>All 8 body/tail/dorsal combinations (goldDust)</h2>
<div class="grid">${anatomyCells.map(cellHtml).join("")}</div>
<h2>Eye styles — every variant in <code>fish/eyes.ts</code></h2>
<p>The app picks one per fish from its own <code>patternSeed</code>; these are forced side by side via <code>bakeFish</code>'s tooling-only override. Iris colour comes from each variety's own palette.</p>
${eyeRows
  .map(
    (r) =>
      `<div class="row"><div class="name">${r.name}</div><div class="cells">${r.cells.map((c) => `<div class="cell eye-cell"><div class="label">${c.label}</div>${c.dataUri ? `<img src="${c.dataUri}" alt="${c.label}" />` : `<div class="fail">bake failed</div>`}</div>`).join("")}</div></div>`,
  )
  .join("\n")}
<h2>Yaw strip — fish-layer.tsx's perspective matrix at 9 headings</h2>
<p>yaw 0°/±180° = broadside (art is nose-left, so 0° here is mirrored nose-right); ±90° = edge-on, floored at EDGE_ON_MIN_WIDTH. Art is nose-left by default (unmirrored, w&gt;0).</p>
<div class="grid">${yawCells.map((c) => `<div class="cell yaw-cell"><div class="label">${c.label}</div>${c.dataUri ? `<img src="${c.dataUri}" alt="${c.label}" />` : `<div class="fail">bake failed</div>`}</div>`).join("")}</div>
<h2>Relight — turning the fish (left half OFF, right half ON)</h2>
<p>Same baked texture, same heading, the only difference is <code>core/shading.ts</code>&#39;s <code>DYNAMIC_RELIGHT</code> gains. The painted highlight is frozen into the texture and reads identically at every yaw; the relit half picks up flank shading and a Fresnel rim as the body turns away from the viewer. This is the tell the flat-card renderer could not fix.</p>
<div class="grid">${relightYawCells.map((c) => `<div class="cell relight-cell"><div class="label">${c.label}</div>${c.dataUri ? `<img src="${c.dataUri}" alt="${c.label}" />` : `<div class="fail">bake failed</div>`}</div>`).join("")}</div>
<h2>Relight — one tail beat at a fixed heading (left half OFF, right half ON)</h2>
<p>The spine warp bends both halves identically. On the right the normal is rotated by the same spine slope the warp solved for, so the highlight travels along the flank with the bend instead of riding the texture.</p>
<div class="grid">${relightBendCells.map((c) => `<div class="cell relight-cell"><div class="label">${c.label}</div>${c.dataUri ? `<img src="${c.dataUri}" alt="${c.label}" />` : `<div class="fail">bake failed</div>`}</div>`).join("")}</div>
<h2>Body normal maps — R = normal x, G = normal y, B = body mask</h2>
<p>The raw <code>fish/normal-map.ts</code> output, one per body type and life stage — six maps serve every fish in the tank, because the field ignores colour, pattern, tail and dorsal. Look for holes in the blue mask, a seam at the peduncle, or a channel stuck flat.</p>
<div class="grid">${normalMapCells.map((c) => `<div class="cell relight-cell"><div class="label">${c.label}</div>${c.dataUri ? `<img src="${c.dataUri}" alt="${c.label}" />` : `<div class="fail">bake failed</div>`}</div>`).join("")}</div>
<h2>Full-scene composite — nature-scape theme, decor only</h2>
<p>Faint vertical lines mark the authored swim lane.</p>
<div class="grid">${sceneCells.map((c) => `<div class="cell scene-cell"><div class="label">${c.label}</div>${c.dataUri ? `<img src="${c.dataUri}" alt="${c.label}" />` : `<div class="fail">bake failed</div>`}</div>`).join("")}</div>
<h2>Sprite-scape composite — approach "B" (shipped PNGs) for A/B comparison against the composite above</h2>
<div class="grid">${spriteSceneCells.map((c) => `<div class="cell scene-cell"><div class="label">${c.label}</div>${c.dataUri ? `<img src="${c.dataUri}" alt="${c.label}" />` : `<div class="fail">no sprite assets supplied</div>`}</div>`).join("")}</div>
<h2>Blender-scape composite — approach "C", the same corridor built from 3D-rendered pieces</h2>
<p>Placed by the SAME <code>compose-sprites.ts</code> machinery as the painted composite above, from <code>themes/blender-scape.ts</code>. Compare against both composites above: this one has no ~1.7x scale ceiling, and its driftwood is one modelled piece rather than three stacked sprites.</p>
<div class="grid">${blenderSceneCells.map((c) => `<div class="cell scene-cell"><div class="label">${c.label}</div>${c.dataUri ? `<img src="${c.dataUri}" alt="${c.label}" />` : `<div class="fail">not rendered</div>`}</div>`).join("")}</div>
<h2>Decor A/B/C — the same species drawn three ways</h2>
<p><b>A</b> = <code>scene/gen/*.ts</code>, Skia paths, infinitely variable but flat-lit. <b>B</b> = the painted PNG, best looking but fixed resolution (<code>themes/nature-scape-sprites.ts</code> documents it breaking past ~1.7x). <b>C</b> = an orthographic render of real 3D geometry from <code>scripts/blender/plant.py</code>, which has no resolution ceiling and carries a normal map. Empty C cells mean <code>yarn decor:blender</code> has not been run.</p>
${decorRows
  .map(
    (r) =>
      `<div class="row"><div class="name">${r.name}</div><div class="cells">${r.cells.map((c) => `<div class="cell decor-cell"><div class="label">${c.label}</div>${c.dataUri ? `<img src="${c.dataUri}" alt="${c.label}" />` : `<div class="fail">not rendered</div>`}</div>`).join("")}</div></div>`,
  )
  .join("\n")}
<h2>Generated breeds — 60 deterministic seeds</h2>
<p>Procedural molly breeds from <code>shared/fish/generated-breed.ts</code> — no catalog entry, no DB column, the <code>gen:&lt;seed&gt;</code> id IS the recipe. Seeds are a fixed stride so this section only changes when the generator does.</p>
<div class="grid">${genCells.map(cellHtml).join("")}</div>
<h2>Generated breeds — grouped by pattern type</h2>
<p>Up to 6 per type, for judging one generator's parameter range at a time.</p>
${genTypeRows
  .map(
    (r) =>
      `<div class="row"><div class="name">${r.name}</div><div class="rarity">${r.rarity}</div><div class="cells">${r.cells.map(cellHtml).join("")}</div></div>`,
  )
  .join("\n")}
<h2>One generated breed — ${showcaseRecipe.name} · ${strainCode(showcaseSeed)} (<code>${showcaseRecipe.id}</code>)</h2>
<p>${showcaseRecipe.description}</p>
<p>Life stages, then the 8 per-individual <code>patternSeed</code> buckets — variation should be visible without the breed losing its identity.</p>
<div class="grid">${genStageCells.map(cellHtml).join("")}</div>
<div class="grid">${genVariantCells.map(cellHtml).join("")}</div>
<h2>Snail — the crawl track it is bound to</h2>
<p>The snail never swims (<code>locomotion: "crawl"</code>). It is placed by <code>sim/crawl.ts</code>'s track: sole on the surface, rotated to its tangent. Every pose below is the SAME texture — check that the foot meets the substrate, the glass and both faces of the stem cleanly.</p>
<div class="grid">${crawlCells.map(cellHtml).join("")}</div>
<h2>Creatures — every non-molly species x its own variant list</h2>
<p>Real anatomy where it's shipped (see <code>creatures/&lt;species&gt;/</code>), the placeholder blob otherwise (see <code>creatures/bake-placeholder.ts</code>).</p>
${creatureRows
  .map(
    (r) =>
      `<div class="row"><div class="name">${r.name}</div><div class="rarity">${r.rarity}</div><div class="cells">${r.cells.map(cellHtml).join("")}</div></div>`,
  )
  .join("\n")}
</body></html>`;

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, html);
  console.log(`Wrote ${OUT_PATH}`);
}

main();
