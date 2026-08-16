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
import { bakeNodes } from "@/shared/aquarium/core/bake";
import { bakeCreature } from "@/shared/aquarium/creatures/bake-creature";
import type { Box, Node } from "@/shared/aquarium/core/ir";
import { getSubstrateEffect, SUBSTRATE_UNIFORM_KEYS } from "@/shared/aquarium/core/sksl/substrate";
import { composeSpriteScene } from "@/shared/aquarium/scene/compose-sprites";
import { composeScene, GENERATORS } from "@/shared/aquarium/scene/compose";
import { DEFAULT_SCENE_DESIGN } from "@/shared/aquarium/scene/scene-design";
import { SCENE_SPRITES } from "@/shared/aquarium/scene/sprites/sprite-manifest";
import { SPRITE_SCAPE } from "@/shared/aquarium/scene/themes/nature-scape-sprites";
import { NATURE_SCAPE } from "@/shared/aquarium/scene/themes/nature-scape";
import { SPECIES_LIST } from "@/shared/creature/catalog";
import type { SpeciesDef, SpeciesId } from "@/shared/creature/types";
import { COLOR_DEFS } from "@/shared/fish/catalog";
import type { BodyId, DorsalId, FishTraits, LifeStage, TailId } from "@/shared/fish/types";
import { parseHex } from "@/shared/lib/color";
import { processTransform } from "@shopify/react-native-skia/src/skia/types/Matrix";
import type { Matrix4, Transforms3d } from "@shopify/react-native-skia/src/skia/types/Matrix4";
import { TileMode } from "@shopify/react-native-skia/src/skia/types";

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

  const toDataUri = (traits: FishTraits, stage: LifeStage): string | null => {
    const baked = bakeFish(Skia, traits, stage, dpr);
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
  const SPRITE_WATER_TOP = "#b8ecfa";
  const SPRITE_WATER_MID = "#5ec3e0";
  const SPRITE_WATER_BOTTOM = "#1a5f79";
  const spriteSceneCells: { label: string; dataUri: string | null }[] = [];
  for (const [w, h] of [
    [390, 844],
    [844, 390],
  ] as const) {
    const substrateY = h - 60;
    const spriteScene = composeSpriteScene(SPRITE_SCAPE, w, h, substrateY);
    if (spriteScene.pieces.length === 0) {
      spriteSceneCells.push({
        label: `${w}x${h} — no sprite assets supplied`,
        dataUri: null,
      });
      continue;
    }
    const surf = Skia.Surface.Make(w, h)!;
    const canvas = surf.getCanvas();
    const waterPaint = Skia.Paint();
    waterPaint.setShader(
      Skia.Shader.MakeLinearGradient(
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
    // Sprite mode's ground is the painted sand piece itself, stretched to
    // the canvas width, over a solid base fill (the piece is a rounded oval
    // clump, not a strip — the fill is what keeps its curved edge from
    // showing water at the corners) — see `render/sprite-layers.tsx`'s
    // `SpriteSubstrate`.
    const sandBasePaint = Skia.Paint();
    sandBasePaint.setShader(
      Skia.Shader.MakeLinearGradient(
        Skia.Point(0, substrateY),
        Skia.Point(0, h),
        [Skia.Color("#efe0ba"), Skia.Color("#cbb887")],
        [0, 1],
        TileMode.Clamp,
      ),
    );
    canvas.drawRect(Skia.XYWHRect(0, substrateY, w, h - substrateY), sandBasePaint);
    const sandSprite = SCENE_SPRITES.sandPatch;
    const sandPngPath = path.join(__dirname, "..", sandSprite.file);
    if (fs.existsSync(sandPngPath)) {
      const sandBytes = fs.readFileSync(sandPngPath);
      const sandImage = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(sandBytes));
      if (sandImage) {
        const sandSrcRect = Skia.XYWHRect(0, 0, sandImage.width(), sandImage.height());
        const sandDestRect = Skia.XYWHRect(0, substrateY, w, h - substrateY);
        canvas.drawImageRect(sandImage, sandSrcRect, sandDestRect, Skia.Paint());
      }
    }
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
      canvas.drawImageRect(image, srcRect, destRect, Skia.Paint());
    }
    const bytes = surf.makeImageSnapshot().encodeToBytes();
    spriteSceneCells.push({
      label: `${w}x${h} — ${spriteScene.pieces.length} pieces`,
      dataUri: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`,
    });
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
  .scene-cell img { width: 320px; background: none; }
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
<h2>Yaw strip — fish-layer.tsx's perspective matrix at 9 headings</h2>
<p>yaw 0°/±180° = broadside (art is nose-left, so 0° here is mirrored nose-right); ±90° = edge-on, floored at EDGE_ON_MIN_WIDTH. Art is nose-left by default (unmirrored, w&gt;0).</p>
<div class="grid">${yawCells.map((c) => `<div class="cell yaw-cell"><div class="label">${c.label}</div>${c.dataUri ? `<img src="${c.dataUri}" alt="${c.label}" />` : `<div class="fail">bake failed</div>`}</div>`).join("")}</div>
<h2>Full-scene composite — nature-scape theme, decor only</h2>
<p>Faint vertical lines mark the authored swim lane.</p>
<div class="grid">${sceneCells.map((c) => `<div class="cell scene-cell"><div class="label">${c.label}</div>${c.dataUri ? `<img src="${c.dataUri}" alt="${c.label}" />` : `<div class="fail">bake failed</div>`}</div>`).join("")}</div>
<h2>Sprite-scape composite — approach "B" (shipped PNGs) for A/B comparison against the composite above</h2>
<div class="grid">${spriteSceneCells.map((c) => `<div class="cell scene-cell"><div class="label">${c.label}</div>${c.dataUri ? `<img src="${c.dataUri}" alt="${c.label}" />` : `<div class="fail">no sprite assets supplied</div>`}</div>`).join("")}</div>
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
