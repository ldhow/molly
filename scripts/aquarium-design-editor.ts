// Interactive designer for the (now the app's only) 2D fish
// (`src/shared/aquarium/`): a tiny local server + browser UI, in the same
// spirit as `tank-design-editor.ts` (3D tank/fish) and the old renderer's
// now-deleted `fish-color-editor.ts` — but this tree had NEITHER an
// interactive shape editor NOR a swim-motion tuner before this (only the
// static `yarn aquarium:preview` gallery). See `src/docs/aquarium-guide.md`
// before changing anything this reads from.
//
// Four tabs, several different save models — deliberately not the same
// model per tab, see each section below for why:
//
// Shape tab (body/fins): drag control points, see the REAL bake
// (`bakeFish`) update live via `/api/bake`. Save is Copy-code only, like
// `fish:colors` — `body-profile.ts`/`fins.ts` carry meaningful INLINE
// comments per point/fin ("crest, forward of centre", "HARD CAP: past
// ~1.6·H...") that a regenerated literal would silently drop, so this tool
// never touches those files on disk.
//
// Motion tab (sim/swim.ts): drag sliders, watch the REAL `stepV2Swim`
// (bundled straight into the browser, not reimplemented) animate real
// baked-fish sprites via the REAL `screenTransformFor`. Save DOES write
// `sim/swim.ts` directly — its tunables are simple `const NAME = value;`
// lines with the "why" living in comments around them, not inline per
// point, so `scripts/lib/swim-const-patch.ts` can replace just the number
// on each line and leave every comment untouched.
//
// Scene tab (procedural decor — `scene-design.ts`/`nature-scape.ts`): a
// real server-rendered preview via `/api/scene-render`, drag pieces or edit
// sliders. Species/water/substrate/bubbles/layers save to `scene-design.ts`
// wholesale (`scene-design-serialize.ts`); placements save `xFraction`/
// `scale`/`mirror` in place, keyed by `seed` (`placement-patch.ts`), since
// `nature-scape.ts` carries curatorial prose between entries a wholesale
// rewrite would destroy.
//
// Sprites tab (shipped-PNG decor — `sprite-manifest.ts`/
// `nature-scape-sprites.ts`): same drag/preview UX as Scene's Placements
// section but rendering real PNGs (`/api/sprite-render`, no bake — see
// `renderSpriteScene`), keyed by ARRAY INDEX instead of `seed` since
// `SpritePlacement` has no unique id (`sprite-placement-patch.ts`). A
// Colours section edits the water/sand hex consts in
// `render/sprite-layers.tsx` directly (`hex-const-patch.ts`, same
// one-line-at-a-time idea as `swim-const-patch.ts` for a string instead of
// a number).
//
// Run: yarn aquarium:design   (http://127.0.0.1:5479, override with PORT=)

import { createServer, type IncomingMessage } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";

import { loadSkiaNode } from "./lib/skia-node";
import { readHexConstants, patchHexConstants } from "./lib/hex-const-patch";
import { readPlacements, patchPlacements, type PlacementChange } from "./lib/placement-patch";
import { serializeSceneDesign } from "./lib/scene-design-serialize";
import {
  readSpritePlacements,
  patchSpritePlacements,
  insertSpritePlacements,
  type SpritePlacementChange,
  type NewSpritePlacement,
} from "./lib/sprite-placement-patch";
import { readSwimConstants, patchSwimConstants, type SwimConstName } from "./lib/swim-const-patch";
import { bakeNodes } from "@/shared/aquarium/core/bake";
import type { Node } from "@/shared/aquarium/core/ir";
import { bakeFish, densityAwareDpr } from "@/shared/aquarium/fish/bake-fish";
import {
  ANAL_FIN,
  CAUDAL_FIN,
  DORSAL_FIN,
  PECTORAL_FAR_FIN,
  PECTORAL_NEAR_FIN,
  PELVIC_FAR_FIN,
  PELVIC_NEAR_FIN,
  type FinSpec,
} from "@/shared/aquarium/fish/fins";
import { BODY_PROFILES, type BodyProfile } from "@/shared/aquarium/fish/body-profile";
import { composeSpriteScene, type SpriteSceneTheme } from "@/shared/aquarium/scene/compose-sprites";
import { composeScene, GENERATORS } from "@/shared/aquarium/scene/compose";
import { DEFAULT_SCENE_DESIGN, type SceneDesign } from "@/shared/aquarium/scene/scene-design";
import { SCENE_SPRITES } from "@/shared/aquarium/scene/sprites/sprite-manifest";
import { SPRITE_SCAPE } from "@/shared/aquarium/scene/themes/nature-scape-sprites";
import { NATURE_SCAPE } from "@/shared/aquarium/scene/themes/nature-scape";
import { sandHeightFor } from "@/shared/constants/tank";
import { COLOR_DEFS } from "@/shared/fish/catalog";
import type { BodyId, DorsalId, FishTraits, LifeStage, TailId } from "@/shared/fish/types";
import { TileMode } from "@shopify/react-native-skia/src/skia/types";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const SWIM_PATH = join(root, "src/shared/aquarium/sim/swim.ts");
const SCENE_DESIGN_PATH = join(root, "src/shared/aquarium/scene/scene-design.ts");
const NATURE_SCAPE_PATH = join(root, "src/shared/aquarium/scene/themes/nature-scape.ts");
const NATURE_SCAPE_SPRITES_PATH = join(
  root,
  "src/shared/aquarium/scene/themes/nature-scape-sprites.ts",
);
const SPRITE_LAYERS_PATH = join(root, "src/shared/aquarium/render/sprite-layers.tsx");
const SPRITE_COLOR_NAMES = [
  "SPRITE_WATER_TOP",
  "SPRITE_WATER_MID",
  "SPRITE_WATER_BOTTOM",
  "SAND_BASE_COLOR",
  "SAND_BASE_COLOR_BOTTOM",
] as const;
const PORT = Number(process.env.PORT) || 5479;

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(err as Error);
      }
    });
    req.on("error", reject);
  });
}

// Pristine snapshots, taken once at boot — what "Reset" in the Shape tab
// restores to, and what the browser starts editing from. `/api/bake`
// mutates the REAL imported `BODY_PROFILES`/fin tables in place (see the
// header comment) so `bakeFish` — which reads those same module-scope
// objects, not a parameter — bakes exactly what's being edited.
const PRISTINE_BODY_PROFILES: Record<BodyId, BodyProfile> = structuredClone(BODY_PROFILES);
const PRISTINE_FINS = {
  dorsal: structuredClone(DORSAL_FIN),
  anal: structuredClone(ANAL_FIN),
  pelvicNear: structuredClone(PELVIC_NEAR_FIN),
  pelvicFar: structuredClone(PELVIC_FAR_FIN),
  pectoralNear: structuredClone(PECTORAL_NEAR_FIN),
  pectoralFar: structuredClone(PECTORAL_FAR_FIN),
  caudal: structuredClone(CAUDAL_FIN),
};

interface ShapeState {
  bodyProfiles: Record<BodyId, BodyProfile>;
  fins: {
    dorsal: Record<DorsalId, FinSpec>;
    anal: FinSpec;
    pelvicNear: FinSpec;
    pelvicFar: FinSpec;
    pectoralNear: FinSpec;
    pectoralFar: FinSpec;
    caudal: Record<TailId, FinSpec>;
  };
}

/** Overwrites the REAL module-scope tables with `state` — see the header comment on why bakeFish needs this rather than a parameter. */
function applyShapeState(state: ShapeState): void {
  BODY_PROFILES.standard = state.bodyProfiles.standard;
  BODY_PROFILES.balloon = state.bodyProfiles.balloon;
  DORSAL_FIN.standard = state.fins.dorsal.standard;
  DORSAL_FIN.sailfin = state.fins.dorsal.sailfin;
  Object.assign(ANAL_FIN, state.fins.anal);
  Object.assign(PELVIC_NEAR_FIN, state.fins.pelvicNear);
  Object.assign(PELVIC_FAR_FIN, state.fins.pelvicFar);
  Object.assign(PECTORAL_NEAR_FIN, state.fins.pectoralNear);
  Object.assign(PECTORAL_FAR_FIN, state.fins.pectoralFar);
  CAUDAL_FIN.round = state.fins.caudal.round;
  CAUDAL_FIN.lyretail = state.fins.caudal.lyretail;
}

// Same pristine-snapshot-at-boot idea as PRISTINE_BODY_PROFILES/PRISTINE_FINS
// above — what "Reset" restores to.
const PRISTINE_SCENE_DESIGN: SceneDesign = structuredClone(DEFAULT_SCENE_DESIGN);

/**
 * Mutates the REAL module-scope `DEFAULT_SCENE_DESIGN` IN PLACE — same
 * reasoning as `applyShapeState` above, but sharper here: every `scene/gen/
 * *.ts` generator captures a reference to its own species' sub-object at
 * import time (`const DESIGN = DEFAULT_SCENE_DESIGN.species.driftwood`), so
 * REPLACING that sub-object (`DEFAULT_SCENE_DESIGN.species.driftwood = ...`)
 * would leave the generator holding a stale reference. `Object.assign` onto
 * the existing sub-object keeps its identity, so every generator's next call
 * sees the new values.
 */
function applySceneDesign(design: SceneDesign): void {
  Object.assign(DEFAULT_SCENE_DESIGN.species.driftwood, design.species.driftwood);
  Object.assign(DEFAULT_SCENE_DESIGN.species.anubias, design.species.anubias);
  Object.assign(DEFAULT_SCENE_DESIGN.species.vallisneria, design.species.vallisneria);
  Object.assign(DEFAULT_SCENE_DESIGN.species.stemBush, design.species.stemBush);
  Object.assign(DEFAULT_SCENE_DESIGN.species.seiryuStone, design.species.seiryuStone);
  Object.assign(DEFAULT_SCENE_DESIGN.species.substrateMound, design.species.substrateMound);
  Object.assign(DEFAULT_SCENE_DESIGN.species.pebbles, design.species.pebbles);
  Object.assign(DEFAULT_SCENE_DESIGN.species.kelp, design.species.kelp);
  Object.assign(DEFAULT_SCENE_DESIGN.species.bloom, design.species.bloom);
  Object.assign(DEFAULT_SCENE_DESIGN.species.cabomba, design.species.cabomba);
  Object.assign(DEFAULT_SCENE_DESIGN.species.sword, design.species.sword);
  Object.assign(DEFAULT_SCENE_DESIGN.water, design.water);
  Object.assign(DEFAULT_SCENE_DESIGN.substrate, design.substrate);
  Object.assign(DEFAULT_SCENE_DESIGN.bubbles, design.bubbles);
  Object.assign(DEFAULT_SCENE_DESIGN.layers, design.layers);
}

interface RenderedPiece {
  key: string;
  species: string;
  seed: number;
  screenX: number;
  screenY: number;
  width: number;
  height: number;
}

/**
 * Composes and bakes the full background — decor via `composeScene`/
 * `GENERATORS`, water/substrate as flat gradients — the SAME code path
 * `scripts/aquarium-preview.ts`'s full-scene composite uses (`bakeNodes`,
 * via `scripts/lib/skia-node.ts`'s real Skia), so the Scene tab's preview is
 * pixel-identical to what ships, not an approximation of it. Placement
 * overrides (in-progress drag values not yet saved) are applied to the REAL
 * `NATURE_SCAPE.placements` objects in place, same in-place-mutation
 * reasoning as `applySceneDesign` — `composeScene` reads `theme.placements`
 * fresh on every call, so this doesn't need its own separate compose path.
 */
async function renderScene(
  width: number,
  height: number,
  placementOverrides: Readonly<Record<number, PlacementChange>>,
): Promise<{ dataUri: string; pieces: RenderedPiece[] }> {
  for (const placement of NATURE_SCAPE.placements) {
    const change = placementOverrides[placement.seed];
    if (change) Object.assign(placement, change);
  }

  const substrateY = height - sandHeightFor(height);
  const scene = composeScene(NATURE_SCAPE, width, height, substrateY);
  const pieces: RenderedPiece[] = [];
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
    pieces.push({
      key: piece.key,
      species: piece.species,
      seed: piece.seed,
      screenX: piece.worldX + generated.bbox.x,
      screenY: piece.worldY + generated.bbox.y,
      width: generated.bbox.width,
      height: generated.bbox.height,
    });
    return {
      kind: "group",
      children: generated.nodes,
      transform: { translateX: piece.worldX, translateY: piece.worldY },
    };
  });

  const Skia = await loadSkiaNode();
  const surf = Skia.Surface.Make(width, height)!;
  const canvas = surf.getCanvas();

  const waterPaint = Skia.Paint();
  waterPaint.setShader(
    Skia.Shader.MakeLinearGradient(
      Skia.Point(0, 0),
      Skia.Point(0, height),
      [Skia.Color(DEFAULT_SCENE_DESIGN.water.top), Skia.Color(DEFAULT_SCENE_DESIGN.water.bottom)],
      [0, 1],
      TileMode.Clamp,
    ),
  );
  canvas.drawRect(Skia.XYWHRect(0, 0, width, height), waterPaint);

  const sandPaint = Skia.Paint();
  sandPaint.setShader(
    Skia.Shader.MakeLinearGradient(
      Skia.Point(0, substrateY),
      Skia.Point(0, height),
      [
        Skia.Color(DEFAULT_SCENE_DESIGN.substrate.top),
        Skia.Color(DEFAULT_SCENE_DESIGN.substrate.bottom),
      ],
      [0, 1],
      TileMode.Clamp,
    ),
  );
  canvas.drawRect(Skia.XYWHRect(0, substrateY, width, height - substrateY), sandPaint);

  const bounds = { x: 0, y: 0, width, height: substrateY };
  const baked = bakeNodes(Skia, decorNodes, bounds, 1);
  if (baked) {
    const srcRect = Skia.XYWHRect(0, 0, baked.image.width(), baked.image.height());
    const destRect = Skia.XYWHRect(bounds.x, bounds.y, bounds.width, bounds.height);
    canvas.drawImageRect(baked.image, srcRect, destRect, Skia.Paint());
  }

  const laneGuide = Skia.Paint();
  laneGuide.setColor(Skia.Color("#ffffff33"));
  for (const lane of scene.swimLaneRects) {
    canvas.drawRect(Skia.XYWHRect(lane.x, 0, 1, height), laneGuide);
    canvas.drawRect(Skia.XYWHRect(lane.x + lane.width, 0, 1, height), laneGuide);
  }

  const bytes = surf.makeImageSnapshot().encodeToBytes();
  return { dataUri: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`, pieces };
}

interface RenderedSpritePiece {
  key: string;
  spriteId: string;
  screenX: number;
  screenY: number;
  width: number;
  height: number;
}

/**
 * Sprite-mode counterpart to `renderScene` — draws real PNGs
 * (`fs.readFileSync` + `Skia.Image.MakeImageFromEncoded`, same pattern
 * `aquarium-preview.ts`'s sprite composite and `verify-aquarium.ts`'s sprite
 * occupancy check use) instead of baking IR nodes, since sprite pieces have
 * no generator to bake. Placement overrides are applied to the REAL
 * `SPRITE_SCAPE.placements` array in place, keyed by ARRAY INDEX rather than
 * a seed — `SpritePlacement` has no unique id (see
 * `scripts/lib/sprite-placement-patch.ts`'s header for why). `additions`
 * (new, not-yet-saved placements from the "+ Add" picker) are appended onto
 * a COPY of the theme for composing only — never pushed into the real
 * `SPRITE_SCAPE.placements` array, so there's no cleanup/pop needed after.
 * Water/sand colours are NOT read from any shared mutable module-scope
 * state (unlike `DEFAULT_SCENE_DESIGN`) — they're plain string consts in
 * `render/sprite-layers.tsx` that this Node script never imports (importing
 * a `.tsx` full of react-native-skia components isn't worth the risk here),
 * so the caller passes the in-progress colour values straight through.
 */
async function renderSpriteScene(
  width: number,
  height: number,
  placementOverrides: Readonly<Record<number, SpritePlacementChange>>,
  colors: Readonly<Record<string, string>>,
  additions: readonly NewSpritePlacement[] = [],
): Promise<{ dataUri: string; pieces: RenderedSpritePiece[] }> {
  SPRITE_SCAPE.placements.forEach((placement, i) => {
    const change = placementOverrides[i];
    if (change) Object.assign(placement, change);
  });
  // `additions` come straight off the wire as plain JSON — `layer` arrives
  // as a bare string, not narrowed to `SceneLayer`. This is a local dev
  // tool with no untrusted caller, so a cast at the boundary (rather than
  // runtime validation) matches how every other route in this file already
  // trusts its request body's shape.
  const theme: SpriteSceneTheme = {
    ...SPRITE_SCAPE,
    placements: [...SPRITE_SCAPE.placements, ...additions] as SpriteSceneTheme["placements"],
  };

  const substrateY = height - sandHeightFor(height);
  const scene = composeSpriteScene(theme, width, height, substrateY);

  const Skia = await loadSkiaNode();
  const surf = Skia.Surface.Make(width, height)!;
  const canvas = surf.getCanvas();

  const waterPaint = Skia.Paint();
  waterPaint.setShader(
    Skia.Shader.MakeLinearGradient(
      Skia.Point(0, 0),
      Skia.Point(0, height),
      [
        Skia.Color(colors.SPRITE_WATER_TOP),
        Skia.Color(colors.SPRITE_WATER_MID),
        Skia.Color(colors.SPRITE_WATER_BOTTOM),
      ],
      [0, 0.55, 1],
      TileMode.Clamp,
    ),
  );
  canvas.drawRect(Skia.XYWHRect(0, 0, width, height), waterPaint);

  const sandBasePaint = Skia.Paint();
  sandBasePaint.setShader(
    Skia.Shader.MakeLinearGradient(
      Skia.Point(0, substrateY),
      Skia.Point(0, height),
      [Skia.Color(colors.SAND_BASE_COLOR), Skia.Color(colors.SAND_BASE_COLOR_BOTTOM)],
      [0, 1],
      TileMode.Clamp,
    ),
  );
  canvas.drawRect(Skia.XYWHRect(0, substrateY, width, height - substrateY), sandBasePaint);

  const sandSprite = SCENE_SPRITES.sandPatch;
  if (sandSprite) {
    const sandImage = Skia.Image.MakeImageFromEncoded(
      Skia.Data.fromBytes(readFileSync(join(root, sandSprite.file))),
    );
    if (sandImage) {
      const srcRect = Skia.XYWHRect(0, 0, sandImage.width(), sandImage.height());
      const destRect = Skia.XYWHRect(0, substrateY, width, height - substrateY);
      canvas.drawImageRect(sandImage, srcRect, destRect, Skia.Paint());
    }
  }

  const pieces: RenderedSpritePiece[] = [];
  for (const piece of scene.pieces) {
    const sprite = SCENE_SPRITES[piece.spriteId];
    if (!sprite) continue;
    const image = Skia.Image.MakeImageFromEncoded(
      Skia.Data.fromBytes(readFileSync(join(root, sprite.file))),
    );
    if (!image) continue;
    const srcRect = Skia.XYWHRect(0, 0, image.width(), image.height());
    const screenX = piece.worldX + piece.rect.x;
    const screenY = piece.worldY + piece.rect.y;
    if (piece.mirror) {
      canvas.save();
      canvas.translate(piece.worldX, piece.worldY);
      canvas.scale(-1, 1);
      canvas.drawImageRect(
        image,
        srcRect,
        Skia.XYWHRect(piece.rect.x, piece.rect.y, piece.rect.width, piece.rect.height),
        Skia.Paint(),
      );
      canvas.restore();
    } else {
      canvas.drawImageRect(
        image,
        srcRect,
        Skia.XYWHRect(screenX, screenY, piece.rect.width, piece.rect.height),
        Skia.Paint(),
      );
    }
    pieces.push({
      key: piece.key,
      spriteId: piece.spriteId,
      screenX,
      screenY,
      width: piece.rect.width,
      height: piece.rect.height,
    });
  }

  const laneGuide2 = Skia.Paint();
  laneGuide2.setColor(Skia.Color("#ffffff33"));
  for (const lane of scene.swimLaneRects) {
    canvas.drawRect(Skia.XYWHRect(lane.x, 0, 1, height), laneGuide2);
    canvas.drawRect(Skia.XYWHRect(lane.x + lane.width, 0, 1, height), laneGuide2);
  }

  const spriteBytes = surf.makeImageSnapshot().encodeToBytes();
  return {
    dataUri: `data:image/png;base64,${Buffer.from(spriteBytes).toString("base64")}`,
    pieces,
  };
}

const BUNDLE_ALIAS: Record<string, string> = {
  "@/shared/lib/swim-model": join(root, "src/shared/lib/swim-model.ts"),
  "@/shared/constants/tank": join(root, "src/shared/constants/tank.ts"),
  "@/shared/aquarium/core/ir": join(root, "src/shared/aquarium/core/ir.ts"),
  "@/shared/fish/types": join(root, "src/shared/fish/types.ts"),
};

/** Bundle the studio's pure math for the browser, fresh on every page load — the existing tools' "edit source, hit refresh" convention. */
function buildClient(): string {
  const out = esbuild.buildSync({
    stdin: {
      contents: `
        import { sampleBodyCurve, finContextFor, buildFin } from "./lib/aquarium-shape-preview";
        import { stepV2Swim, initV2SwimState, currentAt, Z_MAX } from "../src/shared/aquarium/sim/swim";
        import { screenTransformFor } from "../src/shared/aquarium/render/screen-transform";
        window.__aquariumLib = Object.assign(window.__aquariumLib || {}, {
          sampleBodyCurve, finContextFor, buildFin,
          stepV2Swim, initV2SwimState, currentAt, Z_MAX,
          screenTransformFor,
        });
      `,
      resolveDir: here,
      loader: "ts",
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2020",
    alias: BUNDLE_ALIAS,
  });
  return out.outputFiles[0].text;
}

/**
 * A virtual esbuild module standing in for `sim/swim.ts`, its content
 * `patchSwimConstants`-patched with the Motion tab's LIVE slider values
 * (never written to disk — that's what Save is for). `stepV2Swim` closes
 * over its own module-scope tuned consts rather than taking them as
 * parameters (by design — production callers shouldn't carry that surface),
 * so the only way to make a slider retune the RUNNING simulation is to
 * rebuild the module with the new numbers baked in and swap the function
 * reference the animation loop calls — this plugin is what lets that
 * rebuild happen from an in-memory string instead of a temp file on disk.
 */
function patchedSwimPlugin(patchedSource: string): esbuild.Plugin {
  const VIRTUAL = "virtual:swim-patched";
  return {
    name: "patched-swim",
    setup(build) {
      build.onResolve({ filter: /^virtual:swim-patched$/ }, () => ({
        path: VIRTUAL,
        namespace: "patched-swim",
      }));
      build.onLoad({ filter: /.*/, namespace: "patched-swim" }, () => ({
        contents: patchedSource,
        loader: "ts",
      }));
    },
  };
}

/**
 * Rebuilds just the swim-simulation slice of `window.__aquariumLib` against
 * `changes`, so the Motion tab's already-running animation loop (which
 * looks up `lib.stepV2Swim` fresh every frame) picks up tuned behaviour on
 * the very next frame — no re-seeding, no page reload. `screenTransformFor`
 * is deliberately NOT part of this rebuild (see the Motion tab's UI hint):
 * it stays on the page-load bundle's `Z_MAX`, so tuning `Z_MAX` specifically
 * lags by one page reload on its (minor, cosmetic) depth-scale term while
 * every other constant — the ones that actually drive steering — applies
 * live.
 */
async function buildMotionBundle(
  swimSource: string,
  changes: Partial<Record<SwimConstName, number>>,
): Promise<string> {
  const patched = patchSwimConstants(swimSource, changes);
  // esbuild's plugin system requires the async `build()` API — `buildSync`
  // rejects any config with `plugins` set, which is why this one (unlike
  // `buildClient()` above) can't be sync.
  const out = await esbuild.build({
    stdin: {
      contents: `
        import { stepV2Swim, initV2SwimState, currentAt, Z_MAX } from "virtual:swim-patched";
        window.__aquariumLib = Object.assign(window.__aquariumLib || {}, {
          stepV2Swim, initV2SwimState, currentAt, Z_MAX,
        });
      `,
      resolveDir: here,
      loader: "ts",
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2020",
    alias: BUNDLE_ALIAS,
    plugins: [patchedSwimPlugin(patched)],
  });
  return out.outputFiles[0].text;
}

const BODY_IDS: BodyId[] = ["standard", "balloon"];
const TAIL_IDS: TailId[] = ["round", "lyretail"];
const DORSAL_IDS: DorsalId[] = ["standard", "sailfin"];
const sidebarColors = COLOR_DEFS.map((d) => ({ id: d.id, name: d.name }));

function html(
  clientJs: string,
  swimConsts: ReturnType<typeof readSwimConstants>,
  placements: ReturnType<typeof readPlacements>,
  spritePlacements: ReturnType<typeof readSpritePlacements>,
  spriteColors: ReturnType<typeof readHexConstants>,
): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Molly aquarium designer</title>
<style>
  :root { color-scheme: dark; --bg:#0a1620; --panel:#10222f; --line:#1d3a4d;
          --text:#e8f4ff; --dim:#8fb3cc; --accent:#37b6ff; }
  * { box-sizing: border-box; }
  body { margin:0; height:100vh; display:flex; flex-direction:column; font:13px/1.45 -apple-system,"Segoe UI",sans-serif;
         background:var(--bg); color:var(--text); overflow:hidden; }
  #topbar { flex:none; display:flex; gap:10px; align-items:center; padding:8px 12px;
            background:var(--panel); border-bottom:1px solid var(--line); flex-wrap:wrap; }
  #topbar label { color:var(--dim); }
  select, input[type=number], input[type=text] { background:#0a1a24; color:var(--text);
          border:1px solid var(--line); border-radius:4px; padding:3px 6px; font:inherit; }
  #tabs { display:inline-flex; }
  #tabs button { border-radius:0; margin:0; }
  #tabs button:first-child { border-radius:6px 0 0 6px; }
  #tabs button:last-child { border-radius:0 6px 6px 0; border-left-width:0; }
  #tabs button.on { background:var(--accent); color:#052030; font-weight:600; }
  button.act { background:#16394f; color:var(--text); border:1px solid var(--line);
               border-radius:6px; padding:5px 11px; cursor:pointer; font:inherit; }
  button.act:hover { border-color:var(--accent); }
  button.act.primary { background:var(--accent); color:#052030; font-weight:600; border-color:transparent; }
  #body { flex:1; min-height:0; display:flex; }
  #nav { width:170px; flex:none; background:var(--panel); border-right:1px solid var(--line);
         overflow-y:auto; padding:8px 0; }
  #nav button { display:block; width:100%; text-align:left; padding:7px 14px; background:none;
                border:0; color:var(--dim); cursor:pointer; font:inherit; }
  #nav button:hover { background:#16304180; color:var(--text); }
  #nav button.on { background:#16394f; color:var(--text); box-shadow:inset 3px 0 var(--accent); }
  #nav .changed::after { content:"•"; color:var(--accent); margin-left:5px; }
  #stage { flex:1; display:flex; flex-direction:column; min-width:0; position:relative; }
  #panel { width:340px; flex:none; background:var(--panel); border-left:1px solid var(--line);
           overflow-y:auto; padding:10px 12px 40px; }
  h2 { font-size:13px; margin:2px 0 10px; color:var(--accent); text-transform:uppercase; letter-spacing:.06em; }
  h3 { font-size:12px; margin:14px 0 6px; color:var(--dim); border-bottom:1px solid var(--line); padding-bottom:3px; }
  .row { display:flex; align-items:center; gap:6px; margin:3px 0; }
  .row > span { flex:1; color:var(--dim); font-size:11.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .row input[type=range] { flex:1.3; min-width:0; accent-color:var(--accent); }
  .row input[type=number] { width:66px; }
  .hint { color:#54788f; font-size:11px; margin:6px 0 0; }
  .doc { color:#6d93ab; font-size:11px; margin:1px 0 6px; line-height:1.4; }
  #shapeSvg { width:100%; flex:1; min-height:0; background:#0a1a24; touch-action:none; cursor:crosshair; }
  #bakedPreview { position:absolute; right:14px; top:14px; width:150px; height:150px;
                  background:#0a1a24; border:1px solid var(--line); border-radius:8px;
                  display:flex; align-items:center; justify-content:center; overflow:hidden; }
  #bakedPreview img { max-width:100%; max-height:100%; image-rendering:pixelated; }
  #motionCanvas { width:100%; flex:1; min-height:0; background:#0a1a24; }
  .tiprow { display:flex; align-items:center; gap:5px; margin:3px 0; }
  .tiprow > b { flex:none; width:34px; color:var(--dim); font-weight:400; font-size:11px; }
  .tiprow input { width:100%; min-width:0; }
  .tiprow button { flex:none; background:#0a1a24; color:var(--dim); border:1px solid var(--line);
                   border-radius:4px; cursor:pointer; width:22px; }
  #toast { position:fixed; left:50%; bottom:22px; transform:translateX(-50%); padding:8px 16px;
           background:#16394f; border:1px solid var(--accent); border-radius:8px;
           opacity:0; transition:opacity .18s; pointer-events:none; z-index:10; }
  #toast.show { opacity:1; }
  #copyBox { position:fixed; inset:0; background:#000000a0; display:none; align-items:center; justify-content:center; z-index:20; }
  #copyBox.show { display:flex; }
  #copyBox textarea { width:min(720px,86vw); height:min(60vh,500px); background:#0a1a24; color:var(--text);
                       border:1px solid var(--accent); border-radius:8px; padding:10px; font:12px ui-monospace,monospace; }
  #copyWrap { display:flex; flex-direction:column; gap:8px; }
  #sceneStage { position:relative; flex:1; min-height:0; background:#0a1a24; overflow:auto;
                display:flex; align-items:center; justify-content:center; }
  #sceneImgWrap { position:relative; flex:none; }
  #sceneImgWrap img { display:block; max-width:none; }
  .piece-hit { position:absolute; border:1px solid transparent; cursor:grab; box-sizing:border-box; }
  .piece-hit:hover { border-color:#ffd18a99; background:#ffd18a14; }
  .piece-hit.dragging { cursor:grabbing; border-color:#ffd18a; background:#ffd18a22; }
  select.small { padding:2px 5px; }
  input[type=color] { width:30px; height:22px; padding:0; border:1px solid var(--line);
                       background:none; border-radius:4px; }
  .row input[type=text] { width:76px; font:11px ui-monospace,monospace; }
  .row input[type=checkbox] { width:auto; }
  .placement-hdr { font-size:11.5px; color:var(--text); margin:2px 0 1px; }
</style></head><body>
<div id="topbar">
  <span id="tabs">
    <button class="act tab on" data-tab="shape">Shape</button>
    <button class="act tab" data-tab="motion">Motion</button>
    <button class="act tab" data-tab="scene">Scene</button>
    <button class="act tab" data-tab="sprites">Sprites</button>
  </span>
  <span id="shapeControls">
    <label>Color <select id="color"></select></label>
    <label>Body <select id="body"></select></label>
    <label>Tail <select id="tail"></select></label>
    <label>Dorsal <select id="dorsal"></select></label>
  </span>
  <span id="motionControls" style="display:none">
    <label>Fish <input id="fishCount" type="number" min="1" max="20" value="8" style="width:52px"></label>
    <label><input id="currentToggle" type="checkbox"> Shared current</label>
    <label><input id="pauseToggle" type="checkbox"> Pause</label>
  </span>
  <span id="sceneControls" style="display:none">
    <label>Canvas <select id="sceneSize" class="small">
      <option value="390x844">390×844 (portrait)</option>
      <option value="430x932">430×932 (portrait, large)</option>
      <option value="844x390">844×390 (landscape)</option>
    </select></label>
  </span>
  <span id="spritesControls" style="display:none">
    <label>Canvas <select id="spriteSize" class="small">
      <option value="390x844">390×844 (portrait)</option>
      <option value="430x932">430×932 (portrait, large)</option>
      <option value="844x390">844×390 (landscape)</option>
    </select></label>
  </span>
  <span style="flex:1"></span>
  <button class="act" id="resetBtn">Reset tab</button>
  <button class="act" id="copyBtn">Copy code</button>
  <button class="act primary" id="saveBtn" style="display:none">Save to sim/swim.ts</button>
</div>
<div id="body">
  <nav id="nav"></nav>
  <div id="stage">
    <div id="shapeView" style="display:flex; flex-direction:column; height:100%">
      <svg id="shapeSvg" viewBox="-90 -55 190 110"></svg>
      <div id="bakedPreview"><span class="hint">baking…</span></div>
    </div>
    <canvas id="motionCanvas" style="display:none"></canvas>
    <div id="sceneStage" style="display:none">
      <div id="sceneImgWrap">
        <img id="sceneImg" alt="scene preview" />
      </div>
    </div>
    <div id="spritesStage" style="display:none">
      <div id="spriteImgWrap">
        <img id="spriteImg" alt="sprite preview" />
      </div>
    </div>
  </div>
  <aside id="panel"></aside>
</div>
<div id="toast"></div>
<div id="copyBox"><div id="copyWrap">
  <textarea id="copyText" readonly></textarea>
  <button class="act primary" id="copyCloseBtn">Close</button>
</div></div>
<script>${clientJs}</script>
<script>
const lib = window.__aquariumLib;
const BODY_PROFILES = ${JSON.stringify(PRISTINE_BODY_PROFILES)};
const FIN_DEFAULTS = ${JSON.stringify(PRISTINE_FINS)};
const SWIM_DEFAULTS = ${JSON.stringify(swimConsts)};
const COLORS = ${JSON.stringify(sidebarColors)};
const BODY_IDS = ${JSON.stringify(BODY_IDS)};
const TAIL_IDS = ${JSON.stringify(TAIL_IDS)};
const DORSAL_IDS = ${JSON.stringify(DORSAL_IDS)};
const SCENE_DEFAULTS = ${JSON.stringify(PRISTINE_SCENE_DESIGN)};
const PLACEMENT_DEFAULTS = ${JSON.stringify(placements)};
const SPRITE_PLACEMENT_DEFAULTS = ${JSON.stringify(spritePlacements)};
const SPRITE_COLOR_DEFAULTS = ${JSON.stringify(spriteColors)};
const SPRITE_IDS = ${JSON.stringify(Object.keys(SCENE_SPRITES))};
const SPRITE_LAYER_IDS = ${JSON.stringify(["far", "back", "mid", "front"])};

const clone = (o) => JSON.parse(JSON.stringify(o));
const round3 = (n) => Math.round(n * 1000) / 1000;

let tab = "shape";
let shape = { bodyProfiles: clone(BODY_PROFILES), fins: clone(FIN_DEFAULTS) };
let swim = Object.fromEntries(SWIM_DEFAULTS.map((c) => [c.name, c.value]));
let sceneDesign = clone(SCENE_DEFAULTS);
let placements = clone(PLACEMENT_DEFAULTS);
let spritePlacements = clone(SPRITE_PLACEMENT_DEFAULTS);
let spriteColors = Object.fromEntries(SPRITE_COLOR_DEFAULTS.map((c) => [c.name, c.value]));

let bodyId = "standard", tailId = "round", dorsalId = "standard", colorId = COLORS[0].id;

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 1800);
}

// ---------------------------------------------------------------------------
// Shape tab
// ---------------------------------------------------------------------------

const PARTS = [
  { id: "body", label: "Body" },
  { id: "dorsal", label: "Dorsal" },
  { id: "anal", label: "Anal" },
  { id: "pelvicNear", label: "Pelvic (near)" },
  { id: "pelvicFar", label: "Pelvic (far)" },
  { id: "pectoralNear", label: "Pectoral (near)" },
  { id: "pectoralFar", label: "Pectoral (far)" },
  { id: "caudal", label: "Caudal" },
];
let activePart = "body";

function currentProfile() { return shape.bodyProfiles[bodyId]; }
function currentFin(part) {
  if (part === "dorsal") return shape.fins.dorsal[dorsalId];
  if (part === "caudal") return shape.fins.caudal[tailId];
  return shape.fins[part];
}

const undoStack = [];
function pushUndo() {
  undoStack.push(JSON.stringify(shape));
  if (undoStack.length > 60) undoStack.shift();
}
window.addEventListener("keydown", (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
  if (tab !== "shape") return;
  const prev = undoStack.pop();
  if (!prev) return;
  e.preventDefault();
  shape = JSON.parse(prev);
  renderShapePanel();
  drawShape();
  scheduleBake();
});

const svg = document.getElementById("shapeSvg");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

function handle(id, x, y, label, color) {
  return '<g data-h="' + esc(id) + '" style="cursor:grab">' +
    '<circle cx="' + x + '" cy="' + y + '" r="1.6" fill="' + color + '" stroke="#0a1620" stroke-width="0.4"/>' +
    (label ? '<text x="' + (x + 2.2) + '" y="' + (y - 1.8) + '" fill="#8fb3cc" font-size="3" style="pointer-events:none">' + esc(label) + "</text>" : "") +
    "</g>";
}

function drawShape() {
  const profile = currentProfile();
  const curve = lib.sampleBodyCurve(profile, 90);
  const poly = (pts) => pts.map((p) => p.x + "," + p.y).join(" ");
  let s = '<line x1="-90" y1="0" x2="100" y2="0" stroke="#1d3a4d" stroke-width="0.3"/>' +
    '<polygon points="' + poly(curve.top) + " " + poly([...curve.bottom].reverse()) + '" ' +
    'fill="#37b6ff14" stroke="#37b6ff" stroke-width="0.5"/>';

  const ctx = lib.finContextFor(profile, bodyId);
  const finEntries = [
    ["dorsal", shape.fins.dorsal[dorsalId]],
    ["anal", shape.fins.anal],
    ["pelvicNear", shape.fins.pelvicNear],
    ["pelvicFar", shape.fins.pelvicFar],
    ["pectoralNear", shape.fins.pectoralNear],
    ["pectoralFar", shape.fins.pectoralFar],
    ["caudal", shape.fins.caudal[tailId]],
  ];
  const built = {};
  for (const [key, spec] of finEntries) {
    const fin = lib.buildFin(spec, ctx);
    built[key] = fin;
    const on = key === activePart;
    s += '<path d="' + fin.d + '" fill="' + (on ? "#ffd18a33" : "#ffffff0a") + '" stroke="' +
      (on ? "#ffd18a" : "#4a708a") + '" stroke-width="0.4"/>';
  }

  if (activePart === "body") {
    profile.top.forEach((p, i) => {
      const x = profile.x0 + p.x * profile.length;
      s += handle("top:" + i, x, -p.y, "", "#e8f4ff");
    });
    profile.bottom.forEach((p, i) => {
      const x = profile.x0 + p.x * profile.length;
      s += handle("bottom:" + i, x, p.y, "", "#ffd18a");
    });
  } else {
    const fin = built[activePart];
    s += handle("pivot", fin.pivot.x, fin.pivot.y, "hub", "#37b6ff");
    fin.tips.forEach((t, i) => {
      s += handle("tip:" + i, t.x, t.y, "t" + i, "#ffd18a");
    });
  }
  svg.innerHTML = s;
}

let dragging = null;
const cursor = svg.createSVGPoint();
function toLocal(e) {
  cursor.x = e.clientX; cursor.y = e.clientY;
  const p = cursor.matrixTransform(svg.getScreenCTM().inverse());
  return { x: p.x, y: p.y };
}
svg.addEventListener("pointerdown", (e) => {
  const g = e.target.closest && e.target.closest("g[data-h]");
  if (!g) return;
  pushUndo();
  dragging = g.dataset.h;
  svg.setPointerCapture(e.pointerId);
});
svg.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  const { x, y } = toLocal(e);
  if (activePart === "body") {
    const profile = currentProfile();
    const [side, idxStr] = dragging.split(":");
    const idx = Number(idxStr);
    const arr = profile[side];
    const u = round3((x - profile.x0) / profile.length);
    const gap = 0.01;
    const lo = idx > 0 ? arr[idx - 1].x + gap : -Infinity;
    const hi = idx < arr.length - 1 ? arr[idx + 1].x - gap : Infinity;
    arr[idx].x = Math.min(Math.max(u, lo), hi);
    arr[idx].y = Math.max(0.5, round3(side === "top" ? -y : y));
  } else {
    const spec = currentFin(activePart);
    const ctx = lib.finContextFor(currentProfile(), bodyId);
    const fin = lib.buildFin(spec, ctx);
    const ref = spec.ref === "H" ? ctx.halfHeight : ctx.length;
    if (dragging === "pivot") {
      // Hub position is derived from uRoot/side/sink, not directly
      // draggable — see the "sink" / "uRoot" numeric fields instead.
    } else if (dragging.startsWith("tip:")) {
      const i = Number(dragging.slice(4));
      const dx = x - fin.pivot.x, dy = y - fin.pivot.y;
      const lenFrac = round3(Math.hypot(dx, dy) / ref);
      let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      let dAngleDeg = angle - spec.axisDeg;
      while (dAngleDeg > 180) dAngleDeg -= 360;
      while (dAngleDeg <= -180) dAngleDeg += 360;
      spec.rays[i] = { dAngleDeg: round3(dAngleDeg), lenFrac: Math.max(0.02, lenFrac) };
    }
  }
  drawShape();
  syncShapeFields();
  scheduleBake();
});
const stopDrag = () => { dragging = null; };
svg.addEventListener("pointerup", stopDrag);
svg.addEventListener("pointercancel", stopDrag);

function numField(label, obj, key, step) {
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = '<span title="' + label + '">' + label + "</span>";
  const box = document.createElement("input");
  box.type = "number"; box.step = step ?? 0.1; box.value = obj[key];
  box.addEventListener("change", () => {
    const n = Number(box.value);
    if (!Number.isFinite(n)) { box.value = obj[key]; return; }
    pushUndo();
    obj[key] = n;
    drawShape(); scheduleBake();
  });
  row.append(box);
  return row;
}

function bulgeFields(spec) {
  const wrap = document.createElement("div");
  const segCount = spec.rays.length - 1;
  if (Array.isArray(spec.bulge)) {
    for (let i = 0; i < segCount; i++) {
      wrap.append(numField("bulge[" + i + "]", spec.bulge, i, 0.02));
    }
  } else {
    wrap.append(numField("bulge (all segments)", spec, "bulge", 0.02));
  }
  const toggle = document.createElement("button");
  toggle.className = "act";
  toggle.textContent = Array.isArray(spec.bulge) ? "Use one value" : "Use per-segment";
  toggle.addEventListener("click", () => {
    pushUndo();
    spec.bulge = Array.isArray(spec.bulge)
      ? spec.bulge[0] ?? 0.15
      : new Array(segCount).fill(spec.bulge);
    drawShape(); syncShapeFields(); scheduleBake();
  });
  wrap.append(toggle);
  return wrap;
}

function syncShapeFields() {
  const panel = document.getElementById("panel");
  panel.innerHTML = "";
  const h = document.createElement("h2");
  h.textContent = PARTS.find((p) => p.id === activePart).label;
  panel.append(h);

  if (activePart === "body") {
    const profile = currentProfile();
    const tip = document.createElement("p");
    tip.className = "hint";
    tip.textContent = "Drag any control point. White = top curve, amber = bottom curve. Points can't cross their neighbours.";
    panel.append(tip);
    panel.append(numField("x0 (nose plane)", profile, "x0", 1));
    panel.append(numField("length", profile, "length", 1));
    const note = document.createElement("p");
    note.className = "hint";
    note.textContent = "Copy code (top bar) to paste this back into body-profile.ts — Save doesn't write to disk here, see the header comment on why. Run yarn verify:aquarium after pasting.";
    panel.append(note);
    return;
  }

  const spec = currentFin(activePart);
  const tip = document.createElement("p");
  tip.className = "hint";
  tip.textContent = "Drag ray tips to reshape the membrane. Hub position comes from uRoot/sink below, not dragging.";
  panel.append(tip);
  panel.append(numField("uRoot (0=nose,1=peduncle)", spec, "uRoot", 0.01));
  panel.append(numField("sink", spec, "sink", 0.5));
  panel.append(numField("axisDeg", spec, "axisDeg", 1));
  const h3 = document.createElement("h3");
  h3.textContent = "Margin";
  panel.append(h3);
  panel.append(bulgeFields(spec));
  panel.append(numField("scallop", spec, "scallop", 0.01));
  panel.append(numField("alpha", spec, "alpha", 0.05));
  panel.append(numField("rayAlpha", spec, "rayAlpha", 0.02));

  const h4 = document.createElement("h3");
  h4.textContent = "Rays (" + spec.rays.length + ")";
  panel.append(h4);
  spec.rays.forEach((r, i) => {
    const del = document.createElement("button");
    del.textContent = "×";
    del.disabled = spec.rays.length <= 2;
    del.title = "Remove ray";
    del.addEventListener("click", () => {
      pushUndo();
      spec.rays.splice(i, 1);
      if (Array.isArray(spec.bulge)) spec.bulge.splice(Math.max(0, i - 1), 1);
      drawShape(); syncShapeFields(); scheduleBake();
    });
    const row = document.createElement("div");
    row.className = "tiprow";
    const b = document.createElement("b");
    b.textContent = "r" + i;
    row.append(b, del);
    panel.append(row);
  });
  const add = document.createElement("button");
  add.className = "act";
  add.textContent = "+ ray";
  add.addEventListener("click", () => {
    pushUndo();
    const last = spec.rays[spec.rays.length - 1];
    const prev = spec.rays[spec.rays.length - 2] ?? { dAngleDeg: last.dAngleDeg - 20, lenFrac: last.lenFrac };
    spec.rays.push({
      dAngleDeg: round3(last.dAngleDeg + (last.dAngleDeg - prev.dAngleDeg) * 0.5),
      lenFrac: round3(last.lenFrac + (last.lenFrac - prev.lenFrac) * 0.5),
    });
    if (Array.isArray(spec.bulge)) spec.bulge.push(spec.bulge[spec.bulge.length - 1] ?? 0.15);
    drawShape(); syncShapeFields(); scheduleBake();
  });
  panel.append(add);

  const note = document.createElement("p");
  note.className = "hint";
  note.textContent = "Copy code (top bar) to paste this back into fins.ts — Save doesn't write to disk here, see the header comment on why. Run yarn verify:aquarium after pasting.";
  panel.append(note);
}

let bakeTimer = null;
function scheduleBake() {
  clearTimeout(bakeTimer);
  bakeTimer = setTimeout(runBake, 180);
}
async function runBake() {
  const img = document.querySelector("#bakedPreview img") || document.createElement("img");
  try {
    const res = await fetch("/api/bake", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        traits: { color: colorId, body: bodyId, tail: tailId, dorsal: dorsalId },
        stage: "adult",
        shape,
      }),
    });
    const body = await res.json();
    if (!res.ok) { document.getElementById("bakedPreview").innerHTML = '<span class="hint">' + esc(body.error) + "</span>"; return; }
    img.src = body.dataUri;
    document.getElementById("bakedPreview").innerHTML = "";
    document.getElementById("bakedPreview").append(img);
  } catch (err) {
    document.getElementById("bakedPreview").innerHTML = '<span class="hint">bake failed</span>';
  }
}

function renderShapeNav() {
  const nav = document.getElementById("nav");
  nav.innerHTML = "";
  for (const p of PARTS) {
    const b = document.createElement("button");
    b.textContent = p.label;
    b.className = p.id === activePart ? "on" : "";
    b.addEventListener("click", () => { activePart = p.id; renderShapePanel(); });
    nav.append(b);
  }
}

function renderShapePanel() {
  renderShapeNav();
  drawShape();
  syncShapeFields();
}

// ---------------------------------------------------------------------------
// Motion tab
// ---------------------------------------------------------------------------

const SWIM_GROUPS = [
  { label: "Turning", names: ["TURN_RATE_MIN", "TURN_RATE_MAX_WALL", "TURN_RATE_BURST", "TURN_RATE_TAU"] },
  { label: "Speed / accel", names: ["ACCEL_TAU", "DECEL_TAU", "TURN_SPEED_PENALTY_MAX", "MAX_DT"] },
  { label: "Wander / walls", names: ["WALL_MARGIN_X", "WALL_MARGIN_Z", "ARRIVE_RADIUS", "HOVER_JITTER", "VERTICAL_WANDER", "Z_MAX", "Y_TAU"] },
  { label: "Banking / pitch", names: ["ROLL_GAIN", "ROLL_MAX", "ROLL_TAU", "PITCH_TAU", "BROADSIDE_BIAS"] },
  { label: "Shared current", names: ["CURRENT_FREQ", "CURRENT_DRIFT_MAX"] },
];
const swimInfo = Object.fromEntries(SWIM_DEFAULTS.map((c) => [c.name, c]));
let activeSwimGroup = SWIM_GROUPS[0].label;

function renderSwimNav() {
  const nav = document.getElementById("nav");
  nav.innerHTML = "";
  for (const g of SWIM_GROUPS) {
    const b = document.createElement("button");
    b.textContent = g.label;
    b.className = (g.label === activeSwimGroup ? "on " : "") + (g.names.some((n) => swim[n] !== swimInfo[n].value) ? "changed" : "");
    b.addEventListener("click", () => { activeSwimGroup = g.label; renderSwimPanel(); });
    nav.append(b);
  }
}

function swimSlider(name) {
  const info = swimInfo[name];
  const row = document.createElement("div");
  const label = document.createElement("div");
  label.className = "row";
  label.innerHTML = '<span title="' + esc(name) + '">' + name + "</span>";
  const range = document.createElement("input");
  const box = document.createElement("input");
  box.type = "number"; box.step = 0.01;
  const v0 = info.value;
  const span = Math.max(Math.abs(v0) * 2, 0.5);
  range.type = "range"; range.min = Math.min(0, v0 - span); range.max = v0 + span; range.step = span / 200;
  range.value = swim[name]; box.value = swim[name];
  const set = (n) => {
    if (!Number.isFinite(n)) return;
    swim[name] = n; range.value = n; box.value = n;
    renderSwimNav();
    scheduleMotionApply();
  };
  range.addEventListener("input", () => set(Number(range.value)));
  box.addEventListener("change", () => set(Number(box.value)));
  label.append(range, box);
  row.append(label);
  if (info.doc) {
    const doc = document.createElement("div");
    doc.className = "doc";
    doc.textContent = info.doc;
    row.append(doc);
  }
  return row;
}

function renderSwimPanel() {
  renderSwimNav();
  const panel = document.getElementById("panel");
  panel.innerHTML = "";
  const h = document.createElement("h2");
  h.textContent = activeSwimGroup;
  panel.append(h);
  const group = SWIM_GROUPS.find((g) => g.label === activeSwimGroup);
  for (const name of group.names) panel.append(swimSlider(name));
  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = activeSwimGroup === "Wander / walls"
    ? "Sliders retune the running simulation live (~200ms). Exception: Z_MAX's effect on the on-screen depth-scale term needs a page reload to update — its effect on steering bounds applies live either way. Save writes sim/swim.ts, then run yarn verify:aquarium."
    : "Sliders retune the running simulation live (~200ms after you stop dragging). Save writes sim/swim.ts directly — run yarn verify:aquarium afterward.";
  panel.append(hint);
}

// A lightweight body+caudal silhouette (straight-line polygons, not the
// real curved fin membrane — the Shape tab already shows the real bake at
// full fidelity; this tab is for tuning MOTION) drawn via the SAME
// screenTransformFor fish-layer.tsx uses, so turning/banking/speed read
// exactly as they would in the app.
function fishPolygons() {
  const profile = currentProfile();
  const curve = lib.sampleBodyCurve(profile, 48);
  const ctx = lib.finContextFor(profile, bodyId);
  const caudal = lib.buildFin(shape.fins.caudal[tailId], ctx);
  const body = [...curve.top, ...[...curve.bottom].reverse()];
  const fin = [caudal.pivot, ...caudal.tips, caudal.pivot];
  const xs = body.map((p) => p.x).concat(fin.map((p) => p.x));
  const width = Math.max(...xs) - Math.min(...xs);
  return { body, fin, width };
}

/**
 * screenTransformFor's matrixW/matrixCosRoll/matrixQ is a genuine Skia
 * projective transform (persp0 = q, per SkMatrix's row-major 3x3 — see
 * toMatrix3 in react-native-skia's own Matrix4.ts), NOT a plain
 * translation: x' = (w*x) / (1 + q*x). Canvas 2D's ctx.transform() can
 * only express affine (6-parameter) transforms, so this projects each
 * point by hand instead of trying to fake the divide with ctx.transform.
 * Composition order matches the Transforms3d list fish-layer.tsx builds
 * (translate, rotate, matrix, scale) applied innermost-first to the point:
 * scale, then the projective matrix, then rotate, then translate.
 */
function projectPoint(p, t) {
  const x = p.x * t.scaleX;
  const y = p.y * t.scaleY;
  const denom = 1 + t.matrixQ * x;
  const mx = (t.matrixW * x) / denom;
  const my = (t.matrixCosRoll * y) / denom;
  const cr = Math.cos(t.rotate), sr = Math.sin(t.rotate);
  return {
    x: t.translateX + mx * cr - my * sr,
    y: t.translateY + mx * sr + my * cr,
  };
}

function drawPolygon(points, t, fillStyle) {
  cctx.beginPath();
  points.forEach((p, i) => {
    const s = projectPoint(p, t);
    if (i === 0) cctx.moveTo(s.x, s.y);
    else cctx.lineTo(s.x, s.y);
  });
  cctx.closePath();
  cctx.fillStyle = fillStyle;
  cctx.fill();
}

const canvas = document.getElementById("motionCanvas");
const cctx = canvas.getContext("2d");
let fishes = [];
let box = { minX: 40, maxX: 350, minY: 40, maxY: 260 };
let raf = null;
let lastT = null;
let paused = false;
let currentOn = false;

function resizeCanvas() {
  const r = canvas.parentElement.getBoundingClientRect();
  canvas.width = r.width; canvas.height = r.height;
  box = { minX: 30, maxX: canvas.width - 30, minY: 30, maxY: canvas.height - 30 };
}

function seedFishes(n) {
  fishes = Array.from({ length: n }, (_, i) => ({
    seed: i / n,
    state: lib.initV2SwimState(box, i / n),
  }));
}

function stepAndDraw(tMs) {
  if (!lastT) lastT = tMs;
  const dt = Math.min(0.064, (tMs - lastT) / 1000);
  lastT = tMs;
  cctx.clearRect(0, 0, canvas.width, canvas.height);
  cctx.strokeStyle = "#1d3a4d";
  cctx.strokeRect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY);

  const { body, fin, width } = fishPolygons();
  for (const f of fishes) {
    if (!paused) {
      lib.stepV2Swim(f.state, box, dt, 1, f.seed * Math.PI * 2, Math.random, currentOn ? 1 : 0);
    }
    const s = f.state;
    const t = lib.screenTransformFor({
      x: s.x, y: s.y, z: s.z, yaw: s.yaw, roll: s.roll, pitch: s.pitch,
      beatPhase: s.beatPhase, speedNorm: s.speedNorm,
      depthScale: 1, bakedWidth: width,
    });
    drawPolygon(body, t, "#7fd7ff");
    drawPolygon(fin, t, "#ffd18a99");
  }
  raf = requestAnimationFrame(stepAndDraw);
}

function mountMotion() {
  resizeCanvas();
  seedFishes(Number(document.getElementById("fishCount").value) || 8);
  if (raf) cancelAnimationFrame(raf);
  lastT = null;
  raf = requestAnimationFrame(stepAndDraw);
}

// stepV2Swim closes over its own module-scope tuned consts (by design —
// production callers shouldn't carry that surface as parameters), so a
// slider can't retune the ALREADY-BUNDLED function in place. Instead this
// asks the server to rebuild just that slice of the bundle against the
// current slider values (POST /api/motion-bundle — see its doc comment in
// aquarium-design-editor.ts) and injects the result, which reassigns
// lib.stepV2Swim etc. The animation loop above looks those up fresh every
// frame, so the very next frame already steers with the new numbers — no
// re-seed, no reload.
let motionBundleTimer = null;
function scheduleMotionApply() {
  clearTimeout(motionBundleTimer);
  motionBundleTimer = setTimeout(applyMotionBundle, 200);
}
async function applyMotionBundle() {
  const changes = Object.fromEntries(Object.entries(swim).filter(([n, v]) => v !== swimInfo[n].value));
  try {
    const res = await fetch("/api/motion-bundle", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ changes }),
    });
    const body = await res.json();
    if (!res.ok) { toast("Motion rebuild failed: " + body.error); return; }
    const s = document.createElement("script");
    s.textContent = body.js;
    document.body.appendChild(s);
    s.remove();
  } catch {
    toast("Motion rebuild failed — check the server log");
  }
}

window.addEventListener("resize", () => { if (tab === "motion") resizeCanvas(); });

// ---------------------------------------------------------------------------
// Scene tab
// ---------------------------------------------------------------------------
//
// Unlike Shape (drag handles over a real server bake) and Motion (the real
// simulator bundled into the browser), this tab's preview is a full PNG
// rendered server-side via \`renderScene()\` — the exact scene/gen/compose
// pipeline \`scripts/aquarium-preview.ts\` uses — because that pipeline needs
// real Skia (\`scripts/lib/skia-node.ts\`), which doesn't bundle for a
// browser. Every slider edit re-requests that PNG, debounced like the Shape
// tab's \`/api/bake\`.
//
// Two save models, matching the split the header comment above documents for
// Shape vs Motion: species/water/substrate/bubbles/layers are a pure config
// object (\`scene-design.ts\`), Saved by a full literal rewrite. Placements
// live inside \`nature-scape.ts\`, which carries real curatorial prose
// BETWEEN entries (the concave-U layout, rule-of-thirds rationale) — Save
// there only patches each placement's xFraction/scale/mirror in place
// (\`scripts/lib/placement-patch.ts\`); species/layer/attachment changes are
// Copy-code only, same as the Shape tab's body-profile.ts/fins.ts split.

const SCENE_SECTIONS = [
  { id: "placements", label: "Placements" },
  { id: "species.driftwood", label: "Driftwood" },
  { id: "species.anubias", label: "Anubias" },
  { id: "species.vallisneria", label: "Vallisneria" },
  { id: "species.stemBush", label: "Stem bush" },
  { id: "species.seiryuStone", label: "Seiryu stone" },
  { id: "species.substrateMound", label: "Substrate mound" },
  { id: "species.pebbles", label: "Pebbles" },
  { id: "species.kelp", label: "Kelp" },
  { id: "species.bloom", label: "Bloom" },
  { id: "species.cabomba", label: "Cabomba" },
  { id: "species.sword", label: "Sword plant" },
  { id: "species.carpet", label: "Carpet" },
  { id: "species.rotala", label: "Rotala" },
  { id: "water", label: "Water" },
  { id: "substrate", label: "Substrate" },
  { id: "bubbles", label: "Bubbles" },
  { id: "layers", label: "Layers" },
];
let activeSceneSection = SCENE_SECTIONS[0].id;

const sceneGet = (path) => path.split(".").reduce((o, k) => o?.[k], sceneDesign);
const sceneGetDefault = (path) => path.split(".").reduce((o, k) => o?.[k], SCENE_DEFAULTS);

// Sensible slider bounds by field-name convention (Min/Range/Factor suffixes
// this tool's own scene-design.ts uses); anything unlisted falls back to a
// value-relative heuristic, same idea as tank-design-editor.ts's rangeFor.
const SCENE_RANGE_HINTS = {
  xFraction: [0, 1, 0.001], scale: [0.1, 3, 0.01],
  heightMin: [0, 900, 1], heightRange: [0, 500, 1],
  baseWidthMin: [0, 60, 0.5], baseWidthRange: [0, 40, 0.5],
  widthMin: [0, 400, 1], widthRange: [0, 300, 1],
  headingBase: [-180, 180, 1], headingRange: [0, 180, 1],
  wanderDeg: [0, 60, 1],
  trunkSegments: [2, 20, 1], branchSegments: [2, 20, 1],
  branchCountMin: [0, 6, 1], branchCountRange: [0, 6, 1],
  forkTMin: [0, 1, 0.01], forkTRange: [0, 1, 0.01],
  forkAngleMin: [0, 90, 1], forkAngleRange: [0, 90, 1],
  branchLenMin: [0, 1, 0.01], branchLenRange: [0, 1, 0.01],
  branchWidthFactor: [0, 1, 0.01],
  lowAnchorT: [0, 1, 0.01], lowAnchorAngleBase: [-180, 180, 1], lowAnchorAngleRange: [0, 90, 1],
  leafCountMin: [0, 12, 1], leafCountRange: [0, 12, 1],
  spreadBase: [0, 40, 1], spreadRange: [0, 40, 1], spreadMin: [0, 40, 1],
  angleJitter: [0, 40, 1],
  stemLenMin: [0, 60, 1], stemLenRange: [0, 60, 1],
  leafLenMin: [0, 100, 1], leafLenRange: [0, 100, 1],
  leafWidthFactorMin: [0, 1, 0.01], leafWidthFactorRange: [0, 1, 0.01], leafWidthFactor: [0, 1, 0.01],
  rhizomeSpan: [0, 20, 0.5], rhizomeTilt: [0, 10, 0.5], rhizomeWidth: [0, 10, 0.5], stemWidth: [0, 6, 0.1],
  unattachedBaseAngle: [-180, 180, 1],
  leafTipLighten: [0, 1, 0.01],
  bladeCountMin: [0, 12, 1], bladeCountRange: [0, 12, 1],
  bladeSpacing: [0, 20, 0.5], stalkSpacing: [0, 20, 0.5],
  leanBase: [0, 20, 0.5], leanJitter: [0, 20, 0.5], leanMin: [0, 60, 1], leanRange: [0, 60, 1],
  curveRange: [0, 60, 1], curveMin: [0, 40, 1],
  angleSpreadBase: [0, 40, 1], angleSpreadRange: [0, 40, 1],
  vertexCountMin: [3, 20, 1], vertexCountRange: [0, 10, 1],
  jitterMin: [0, 1.5, 0.01], jitterRange: [0, 1.5, 0.01],
  countMin: [0, 20, 1], countRange: [0, 20, 1],
  spreadRange: [0, 200, 1],
  radiusMin: [0, 20, 0.5], radiusRange: [0, 20, 0.5],
  frondCountMin: [0, 10, 1], frondCountRange: [0, 10, 1],
  stalkCountMin: [0, 10, 1], stalkCountRange: [0, 10, 1],
  stalkWidthMin: [0, 6, 0.1], stalkWidthRange: [0, 6, 0.1],
  leafletLenMin: [0, 20, 0.5], leafletLenRange: [0, 20, 0.5],
  swayHeightFactor: [0, 200, 1],
  droopMin: [0, 30, 0.5], droopRange: [0, 30, 0.5],
  petalRadiusMin: [0, 10, 0.1], petalRadiusRange: [0, 10, 0.1], petalCount: [3, 10, 1],
  stemCountMin: [0, 8, 1], stemCountRange: [0, 8, 1],
  count: [0, 40, 1], spriteSize: [4, 80, 1],
  opacityBack: [0, 1, 0.01], opacityMid: [0, 1, 0.01], opacityFront: [0, 1, 0.01], opacityFar: [0, 1, 0.01],
  currentLean: [0, 0.3, 0.005],
  knotCountMin: [0, 6, 1], knotCountRange: [0, 6, 1],
  knotRadiusMin: [0, 10, 0.1], knotRadiusRange: [0, 10, 0.1],
  contactShadowRadius: [0, 4, 0.05], contactShadowStrength: [0, 1, 0.01],
  facetCountMin: [0, 6, 1], facetCountRange: [0, 6, 1],
  grainStrength: [0, 1, 0.01], speckleDensity: [0, 1, 0.01],
  clumpCountMin: [0, 16, 1], clumpCountRange: [0, 16, 1],
  leafRadiusMin: [0, 12, 0.1], leafRadiusRange: [0, 12, 0.1],
  parallaxAmplitude: [0, 40, 0.5], parallaxPeriodSec: [10, 120, 1],
  parallaxFar: [0, 1.5, 0.01], parallaxBack: [0, 1.5, 0.01], parallaxMid: [0, 1.5, 0.01], parallaxFront: [0, 1.5, 0.01],
};

function sceneRangeFor(key, value) {
  if (SCENE_RANGE_HINTS[key]) return SCENE_RANGE_HINTS[key];
  const a = Math.abs(value);
  if (a === 0) return [-1, 1, 0.01];
  if (a < 1) return [0, a * 3, 0.01];
  if (a <= 20) return [0, a * 3, 0.1];
  return [0, a * 3, 1];
}

function sceneSnap(value, step) {
  if (!Number.isFinite(step) || step <= 0) return value;
  const decimals = (String(step).split(".")[1] || "").length;
  return Number((Math.round(value / step) * step).toFixed(decimals));
}

function isColorValue(v) { return typeof v === "string" && /^#[0-9a-f]{3,8}$/i.test(v); }

function sceneChanged() {
  renderSceneNav();
  scheduleSceneRender();
}

function sceneNumberRow(label, obj, key, onChange) {
  onChange = onChange || sceneChanged;
  const [min, max, step] = sceneRangeFor(key, obj[key]);
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = '<span title="' + label + '">' + label + "</span>";
  const slider = document.createElement("input");
  slider.type = "range"; slider.min = min; slider.max = max; slider.step = step;
  slider.value = obj[key];
  const box = document.createElement("input");
  box.type = "number"; box.step = step; box.value = obj[key];
  const set = (v) => {
    const raw = Number(v);
    if (!Number.isFinite(raw)) return;
    const n = sceneSnap(raw, step);
    obj[key] = n; slider.value = n; box.value = n; onChange();
  };
  slider.addEventListener("input", () => set(slider.value));
  box.addEventListener("change", () => set(box.value));
  row.append(slider, box);
  return row;
}

function sceneColorRow(label, obj, key, onChange) {
  onChange = onChange || sceneChanged;
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = '<span title="' + label + '">' + label + "</span>";
  const pick = document.createElement("input");
  pick.type = "color"; pick.value = obj[key];
  const text = document.createElement("input");
  text.type = "text"; text.value = obj[key];
  const set = (v) => { obj[key] = v; pick.value = v; text.value = v; onChange(); };
  pick.addEventListener("input", () => set(pick.value));
  text.addEventListener("change", () => { if (isColorValue(text.value)) set(text.value); });
  row.append(pick, text);
  return row;
}

function sceneBoolRow(label, obj, key, onChange) {
  onChange = onChange || sceneChanged;
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = "<span>" + label + "</span>";
  const cb = document.createElement("input");
  cb.type = "checkbox"; cb.checked = !!obj[key];
  cb.addEventListener("change", () => { obj[key] = cb.checked; onChange(); });
  row.append(cb);
  return row;
}

/** Every scene-design.ts leaf is a flat object of scalars — no nested emit needed, unlike tank-design's deep tree. */
function sceneEmit(into, obj) {
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "number") into.append(sceneNumberRow(k, obj, k));
    else if (isColorValue(v)) into.append(sceneColorRow(k, obj, k));
    else if (typeof v === "boolean") into.append(sceneBoolRow(k, obj, k));
  }
}

function placementChangedFromDefault(p, i) {
  const d = PLACEMENT_DEFAULTS[i];
  return p.xFraction !== d.xFraction || p.scale !== d.scale || !!p.mirror !== !!d.mirror;
}

function placementsSection(panel) {
  const tip = document.createElement("p");
  tip.className = "hint";
  tip.textContent = "Drag a piece in the preview to move it (updates xFraction), or edit the fields below. Position/scale/mirror save directly to nature-scape.ts. Adding/removing a placement, or changing species/layer/attachment, isn't supported here — use Copy code and edit nature-scape.ts by hand for that.";
  panel.append(tip);
  placements.forEach((p, i) => {
    const hdr = document.createElement("div");
    hdr.className = "placement-hdr";
    hdr.textContent = p.species + " · " + p.layer +
      (p.id ? " · id=" + p.id : "") + (p.attachToId ? " · on " + p.attachToId : "") +
      " · seed=" + p.seed + (placementChangedFromDefault(p, i) ? " •" : "");
    panel.append(hdr);
    panel.append(sceneNumberRow("xFraction", p, "xFraction"));
    panel.append(sceneNumberRow("scale", p, "scale"));
    panel.append(sceneBoolRow("mirror", p, "mirror"));
  });
}

function sceneSectionChanged(id) {
  if (id === "placements") return placements.some((p, i) => placementChangedFromDefault(p, i));
  return JSON.stringify(sceneGet(id)) !== JSON.stringify(sceneGetDefault(id));
}

function renderSceneNav() {
  const nav = document.getElementById("nav");
  nav.innerHTML = "";
  for (const s of SCENE_SECTIONS) {
    const b = document.createElement("button");
    b.textContent = s.label;
    b.className = (s.id === activeSceneSection ? "on " : "") + (sceneSectionChanged(s.id) ? "changed" : "");
    b.addEventListener("click", () => { activeSceneSection = s.id; renderSceneNav(); renderScenePanel(); });
    nav.append(b);
  }
}

function renderScenePanel() {
  const panel = document.getElementById("panel");
  panel.innerHTML = "";
  const section = SCENE_SECTIONS.find((s) => s.id === activeSceneSection);
  const h = document.createElement("h2");
  h.textContent = section.label;
  panel.append(h);

  if (activeSceneSection === "placements") placementsSection(panel);
  else sceneEmit(panel, sceneGet(activeSceneSection));

  const note = document.createElement("p");
  note.className = "hint";
  note.textContent = activeSceneSection === "placements"
    ? "Save placements writes into nature-scape.ts, preserving every comment. Run yarn verify:aquarium after."
    : "Save scene writes scene-design.ts directly. Run yarn verify:aquarium after.";
  panel.append(note);

  // Redraw the overlay hit-boxes: only the Placements section needs them
  // draggable, but switching sections shouldn't require a re-render to
  // reflect that.
  if (lastScenePieces) renderPieceOverlays(lastScenePieces, currentSceneSize().w);
  updateSaveBtnLabel();
}

function currentSceneSize() {
  const [w, h] = document.getElementById("sceneSize").value.split("x").map(Number);
  return { w, h };
}

let sceneRenderTimer = null;
function scheduleSceneRender() {
  clearTimeout(sceneRenderTimer);
  sceneRenderTimer = setTimeout(runSceneRender, 180);
}

let lastScenePieces = null;
async function runSceneRender() {
  const { w, h } = currentSceneSize();
  const placementChanges = {};
  for (const p of placements) {
    placementChanges[p.seed] = { xFraction: p.xFraction, scale: p.scale, mirror: !!p.mirror };
  }
  try {
    const res = await fetch("/api/scene-render", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ design: sceneDesign, placements: placementChanges, width: w, height: h }),
    });
    const body = await res.json();
    if (!res.ok) { toast("Scene render failed: " + body.error); return; }
    const img = document.getElementById("sceneImg");
    const wrap = document.getElementById("sceneImgWrap");
    img.src = body.dataUri;
    wrap.style.width = w + "px";
    wrap.style.height = h + "px";
    lastScenePieces = body.pieces;
    renderPieceOverlays(body.pieces, w);
  } catch (err) {
    toast("Scene render failed — check the server log");
  }
}

function renderPieceOverlays(pieces, canvasWidth) {
  const wrap = document.getElementById("sceneImgWrap");
  wrap.querySelectorAll(".piece-hit").forEach((el) => el.remove());
  if (activeSceneSection !== "placements") return;
  for (const piece of pieces) {
    const el = document.createElement("div");
    el.className = "piece-hit";
    el.style.left = piece.screenX + "px";
    el.style.top = piece.screenY + "px";
    el.style.width = Math.max(4, piece.width) + "px";
    el.style.height = Math.max(4, piece.height) + "px";
    el.title = piece.species + " (seed " + piece.seed + ")";
    el.addEventListener("pointerdown", (e) => startPieceDrag(e, piece.seed, canvasWidth));
    wrap.append(el);
  }
}

let pieceDrag = null;
function startPieceDrag(e, seed, canvasWidth) {
  const placement = placements.find((p) => p.seed === seed);
  if (!placement) return;
  e.currentTarget.classList.add("dragging");
  e.currentTarget.setPointerCapture(e.pointerId);
  pieceDrag = { seed, startClientX: e.clientX, startXFraction: placement.xFraction, canvasWidth, el: e.currentTarget };
}
document.addEventListener("pointermove", (e) => {
  if (!pieceDrag) return;
  const placement = placements.find((p) => p.seed === pieceDrag.seed);
  if (!placement) return;
  const dx = e.clientX - pieceDrag.startClientX;
  placement.xFraction = round3(
    Math.min(1, Math.max(0, pieceDrag.startXFraction + dx / pieceDrag.canvasWidth)),
  );
  if (activeSceneSection === "placements") renderScenePanel();
  scheduleSceneRender();
});
document.addEventListener("pointerup", (e) => {
  if (!pieceDrag) return;
  pieceDrag.el.classList.remove("dragging");
  pieceDrag = null;
});

document.getElementById("sceneSize").addEventListener("change", () => scheduleSceneRender());

// ---------------------------------------------------------------------------
// Sprites tab — real painted PNGs instead of generated species; same
// drag-to-reposition/live-preview UX as the Scene tab's Placements section,
// reusing sceneNumberRow/sceneColorRow/sceneBoolRow with an explicit
// onChange so edits here don't touch sceneDesign/placements state.
// ---------------------------------------------------------------------------

const SPRITES_SECTIONS = [
  { id: "placements", label: "Placements" },
  { id: "colors", label: "Colours" },
];
let activeSpritesSection = SPRITES_SECTIONS[0].id;

function spritesChanged() {
  renderSpritesNav();
  scheduleSpriteRender();
}

// Adding/removing a row changes which DOM elements need to exist, not just
// a value inside one — needs a full panel rebuild, unlike an in-place
// slider/checkbox edit (which sceneNumberRow/sceneColorRow/sceneBoolRow
// already handle via their own onChange).
function spritePlacementsListChanged() {
  renderSpritesNav();
  renderSpritesPanel();
  scheduleSpriteRender();
}

/** Indices >= SPRITE_PLACEMENT_DEFAULTS.length are additions from this session's "+ Add" — see insertSpritePlacements's header for why appending is safe but reordering/removing a SAVED entry isn't supported here. */
function isNewSpritePlacement(i) {
  return i >= SPRITE_PLACEMENT_DEFAULTS.length;
}

function spritePlacementChangedFromDefault(p, i) {
  const d = SPRITE_PLACEMENT_DEFAULTS[i];
  if (!d) return true; // a new, not-yet-saved addition
  return p.xFraction !== d.xFraction || p.scale !== d.scale || !!p.mirror !== !!d.mirror;
}

function spriteAddRow(panel) {
  const row = document.createElement("div");
  row.className = "row";
  const spriteSel = document.createElement("select");
  spriteSel.className = "small";
  spriteSel.innerHTML = SPRITE_IDS.map((id) => '<option value="' + id + '">' + id + "</option>").join("");
  const layerSel = document.createElement("select");
  layerSel.className = "small";
  layerSel.innerHTML = SPRITE_LAYER_IDS.map((l) => '<option value="' + l + '">' + l + "</option>").join("");
  layerSel.value = "mid";
  const addBtn = document.createElement("button");
  addBtn.className = "act";
  addBtn.textContent = "+ Add";
  addBtn.addEventListener("click", () => {
    spritePlacements.push({ spriteId: spriteSel.value, layer: layerSel.value, xFraction: 0.5, scale: 1, mirror: false });
    spritePlacementsListChanged();
  });
  row.append(spriteSel, layerSel, addBtn);
  panel.append(row);
}

function spritePlacementsSection(panel) {
  const tip = document.createElement("p");
  tip.className = "hint";
  tip.textContent = "Drag a piece in the preview to move it (updates xFraction), or edit the fields below. Position/scale/mirror save directly to nature-scape-sprites.ts. Add a new piece with the picker below (appears centered — drag it into place). Removing or reordering an already-saved placement, or changing its spriteId/layer, isn't supported here — use Copy code and edit nature-scape-sprites.ts by hand for that.";
  panel.append(tip);
  spriteAddRow(panel);
  spritePlacements.forEach((p, i) => {
    const isNew = isNewSpritePlacement(i);
    const hdr = document.createElement("div");
    hdr.className = "placement-hdr";
    hdr.textContent = p.spriteId + " · " + p.layer + (isNew ? " · new" : "") + (spritePlacementChangedFromDefault(p, i) ? " •" : "");
    if (isNew) {
      const rm = document.createElement("button");
      rm.className = "act";
      rm.textContent = "✕";
      rm.style.marginLeft = "8px";
      rm.title = "Remove this not-yet-saved placement";
      rm.addEventListener("click", () => {
        spritePlacements.splice(i, 1);
        spritePlacementsListChanged();
      });
      hdr.append(rm);
    }
    panel.append(hdr);
    panel.append(sceneNumberRow("xFraction", p, "xFraction", spritesChanged));
    panel.append(sceneNumberRow("scale", p, "scale", spritesChanged));
    panel.append(sceneBoolRow("mirror", p, "mirror", spritesChanged));
  });
}

function spriteColorsSection(panel) {
  for (const c of SPRITE_COLOR_DEFAULTS) {
    panel.append(sceneColorRow(c.name, spriteColors, c.name, spritesChanged));
  }
}

function spritesSectionChanged(id) {
  if (id === "placements") return spritePlacements.some((p, i) => spritePlacementChangedFromDefault(p, i));
  return SPRITE_COLOR_DEFAULTS.some((c) => spriteColors[c.name] !== c.value);
}

function renderSpritesNav() {
  const nav = document.getElementById("nav");
  nav.innerHTML = "";
  for (const s of SPRITES_SECTIONS) {
    const b = document.createElement("button");
    b.textContent = s.label;
    b.className = (s.id === activeSpritesSection ? "on " : "") + (spritesSectionChanged(s.id) ? "changed" : "");
    b.addEventListener("click", () => { activeSpritesSection = s.id; renderSpritesNav(); renderSpritesPanel(); });
    nav.append(b);
  }
}

function renderSpritesPanel() {
  const panel = document.getElementById("panel");
  panel.innerHTML = "";
  const section = SPRITES_SECTIONS.find((s) => s.id === activeSpritesSection);
  const h = document.createElement("h2");
  h.textContent = section.label;
  panel.append(h);

  if (activeSpritesSection === "placements") spritePlacementsSection(panel);
  else spriteColorsSection(panel);

  const note = document.createElement("p");
  note.className = "hint";
  note.textContent = activeSpritesSection === "placements"
    ? "Save placements writes into nature-scape-sprites.ts, preserving every comment. Run yarn verify:aquarium after."
    : "Save colours writes into render/sprite-layers.tsx directly (note: aquarium-preview.ts keeps its own copy of these — see that script's sprite composite). Run yarn verify:aquarium after.";
  panel.append(note);

  if (lastSpritePieces) renderSpritePieceOverlays(lastSpritePieces, currentSpriteSize().w);
  updateSaveBtnLabel();
}

function currentSpriteSize() {
  const [w, h] = document.getElementById("spriteSize").value.split("x").map(Number);
  return { w, h };
}

let spriteRenderTimer = null;
function scheduleSpriteRender() {
  clearTimeout(spriteRenderTimer);
  spriteRenderTimer = setTimeout(runSpriteRender, 180);
}

let lastSpritePieces = null;
async function runSpriteRender() {
  const { w, h } = currentSpriteSize();
  const placementChanges = {};
  const additions = [];
  spritePlacements.forEach((p, i) => {
    const entry = { xFraction: p.xFraction, scale: p.scale, mirror: !!p.mirror };
    if (isNewSpritePlacement(i)) additions.push(Object.assign({ spriteId: p.spriteId, layer: p.layer }, entry));
    else placementChanges[i] = entry;
  });
  try {
    const res = await fetch("/api/sprite-render", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ placements: placementChanges, additions, colors: spriteColors, width: w, height: h }),
    });
    const body = await res.json();
    if (!res.ok) { toast("Sprite render failed: " + body.error); return; }
    const img = document.getElementById("spriteImg");
    const wrap = document.getElementById("spriteImgWrap");
    img.src = body.dataUri;
    wrap.style.width = w + "px";
    wrap.style.height = h + "px";
    lastSpritePieces = body.pieces;
    renderSpritePieceOverlays(body.pieces, w);
  } catch (err) {
    toast("Sprite render failed — check the server log");
  }
}

function renderSpritePieceOverlays(pieces, canvasWidth) {
  const wrap = document.getElementById("spriteImgWrap");
  wrap.querySelectorAll(".piece-hit").forEach((el) => el.remove());
  if (activeSpritesSection !== "placements") return;
  pieces.forEach((piece, i) => {
    const el = document.createElement("div");
    el.className = "piece-hit";
    el.style.left = piece.screenX + "px";
    el.style.top = piece.screenY + "px";
    el.style.width = Math.max(4, piece.width) + "px";
    el.style.height = Math.max(4, piece.height) + "px";
    el.title = piece.spriteId;
    el.addEventListener("pointerdown", (e) => startSpritePieceDrag(e, i, canvasWidth));
    wrap.append(el);
  });
}

// Overlay index i matches spritePlacements[i] because composeSpriteScene
// (server-side) iterates theme.placements in order and only skips an entry
// if its manifest lookup fails — which won't happen for a manifest that's
// kept in sync — so it never reorders relative to the client's array.
let spritePieceDrag = null;
function startSpritePieceDrag(e, index, canvasWidth) {
  const placement = spritePlacements[index];
  if (!placement) return;
  e.currentTarget.classList.add("dragging");
  e.currentTarget.setPointerCapture(e.pointerId);
  spritePieceDrag = { index, startClientX: e.clientX, startXFraction: placement.xFraction, canvasWidth, el: e.currentTarget };
}
document.addEventListener("pointermove", (e) => {
  if (!spritePieceDrag) return;
  const placement = spritePlacements[spritePieceDrag.index];
  if (!placement) return;
  const dx = e.clientX - spritePieceDrag.startClientX;
  placement.xFraction = round3(
    Math.min(1, Math.max(0, spritePieceDrag.startXFraction + dx / spritePieceDrag.canvasWidth)),
  );
  if (activeSpritesSection === "placements") renderSpritesPanel();
  scheduleSpriteRender();
});
document.addEventListener("pointerup", (e) => {
  if (!spritePieceDrag) return;
  spritePieceDrag.el.classList.remove("dragging");
  spritePieceDrag = null;
});

document.getElementById("spriteSize").addEventListener("change", () => scheduleSpriteRender());

// ---------------------------------------------------------------------------
// Tabs / top bar / save / copy
// ---------------------------------------------------------------------------

function updateSaveBtnLabel() {
  const btn = document.getElementById("saveBtn");
  if (tab === "motion") btn.textContent = "Save to sim/swim.ts";
  else if (tab === "scene") {
    btn.textContent = activeSceneSection === "placements" ? "Save placements" : "Save scene";
  } else if (tab === "sprites") {
    btn.textContent = activeSpritesSection === "placements" ? "Save sprite placements" : "Save sprite colours";
  }
}

function setTab(next) {
  tab = next;
  document.querySelectorAll("#tabs .tab").forEach((b) => b.classList.toggle("on", b.dataset.tab === next));
  document.getElementById("shapeControls").style.display = next === "shape" ? "" : "none";
  document.getElementById("motionControls").style.display = next === "motion" ? "" : "none";
  document.getElementById("sceneControls").style.display = next === "scene" ? "" : "none";
  document.getElementById("spritesControls").style.display = next === "sprites" ? "" : "none";
  document.getElementById("shapeView").style.display = next === "shape" ? "flex" : "none";
  document.getElementById("motionCanvas").style.display = next === "motion" ? "block" : "none";
  document.getElementById("sceneStage").style.display = next === "scene" ? "flex" : "none";
  document.getElementById("spritesStage").style.display = next === "sprites" ? "flex" : "none";
  document.getElementById("saveBtn").style.display = next === "shape" ? "none" : "";
  if (next === "shape") { renderShapePanel(); scheduleBake(); }
  else if (next === "motion") { renderSwimPanel(); mountMotion(); }
  else if (next === "scene") { renderSceneNav(); renderScenePanel(); scheduleSceneRender(); }
  else { renderSpritesNav(); renderSpritesPanel(); scheduleSpriteRender(); }
  updateSaveBtnLabel();
}
document.querySelectorAll("#tabs .tab").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));

const colorSel = document.getElementById("color");
colorSel.innerHTML = COLORS.map((c) => '<option value="' + c.id + '">' + c.name + "</option>").join("");
colorSel.value = colorId;
colorSel.addEventListener("change", () => { colorId = colorSel.value; scheduleBake(); });

const bodySel = document.getElementById("body");
bodySel.innerHTML = BODY_IDS.map((b) => '<option value="' + b + '">' + b + "</option>").join("");
bodySel.value = bodyId;
bodySel.addEventListener("change", () => { bodyId = bodySel.value; renderShapePanel(); scheduleBake(); });

const tailSel = document.getElementById("tail");
tailSel.innerHTML = TAIL_IDS.map((t) => '<option value="' + t + '">' + t + "</option>").join("");
tailSel.value = tailId;
tailSel.addEventListener("change", () => {
  tailId = tailSel.value;
  if (activePart === "caudal") renderShapePanel(); else drawShape();
  scheduleBake();
});

const dorsalSel = document.getElementById("dorsal");
dorsalSel.innerHTML = DORSAL_IDS.map((d) => '<option value="' + d + '">' + d + "</option>").join("");
dorsalSel.value = dorsalId;
dorsalSel.addEventListener("change", () => {
  dorsalId = dorsalSel.value;
  if (activePart === "dorsal") renderShapePanel(); else drawShape();
  scheduleBake();
});

document.getElementById("fishCount").addEventListener("change", () => seedFishes(Number(document.getElementById("fishCount").value) || 8));
document.getElementById("currentToggle").addEventListener("change", (e) => { currentOn = e.target.checked; });
document.getElementById("pauseToggle").addEventListener("change", (e) => { paused = e.target.checked; });

document.getElementById("resetBtn").addEventListener("click", () => {
  if (!confirm("Discard changes on this tab and return to the shipped values?")) return;
  if (tab === "shape") {
    shape = { bodyProfiles: clone(BODY_PROFILES), fins: clone(FIN_DEFAULTS) };
    renderShapePanel(); scheduleBake();
  } else if (tab === "motion") {
    swim = Object.fromEntries(SWIM_DEFAULTS.map((c) => [c.name, c.value]));
    renderSwimPanel();
    toast("Reset — reload the page to see the bundled simulator use shipped values again");
  } else if (tab === "scene") {
    sceneDesign = clone(SCENE_DEFAULTS);
    placements = clone(PLACEMENT_DEFAULTS);
    renderSceneNav(); renderScenePanel(); scheduleSceneRender();
  } else {
    spritePlacements = clone(SPRITE_PLACEMENT_DEFAULTS);
    spriteColors = Object.fromEntries(SPRITE_COLOR_DEFAULTS.map((c) => [c.name, c.value]));
    renderSpritesNav(); renderSpritesPanel(); scheduleSpriteRender();
  }
});

function showCopy(text) {
  document.getElementById("copyText").value = text;
  document.getElementById("copyBox").classList.add("show");
}
document.getElementById("copyCloseBtn").addEventListener("click", () => document.getElementById("copyBox").classList.remove("show"));

document.getElementById("copyBtn").addEventListener("click", () => {
  if (tab === "motion") {
    const lines = Object.entries(swim)
      .filter(([n, v]) => v !== swimInfo[n].value)
      .map(([n, v]) => n + " = " + v + ";");
    showCopy(lines.length ? lines.join("\\n") : "(no changes)");
    return;
  }
  if (tab === "scene") {
    if (activeSceneSection === "placements") {
      const literalPlacements = placements.map((p) => {
        const out = { species: p.species, layer: p.layer, xFraction: p.xFraction, scale: p.scale, seed: p.seed };
        if (p.id !== undefined) out.id = p.id;
        if (p.attachToId !== undefined) out.attachToId = p.attachToId;
        if (p.anchorIndex !== undefined) out.anchorIndex = p.anchorIndex;
        if (p.mirror) out.mirror = true;
        return out;
      });
      showCopy(
        "// Paste into src/shared/aquarium/scene/themes/nature-scape.ts's NATURE_SCAPE, replacing placements:\\n" +
        "placements: " + serializeLiteral(literalPlacements) + ","
      );
      return;
    }
    showCopy(
      "// Paste into src/shared/aquarium/scene/scene-design.ts's DEFAULT_SCENE_DESIGN, replacing " + activeSceneSection + ":\\n" +
      activeSceneSection + ": " + serializeLiteral(sceneGet(activeSceneSection)) + ","
    );
    return;
  }
  if (tab === "sprites") {
    if (activeSpritesSection === "placements") {
      const literalPlacements = spritePlacements.map((p) => {
        const out = { spriteId: p.spriteId, layer: p.layer, xFraction: p.xFraction, scale: p.scale };
        if (p.mirror) out.mirror = true;
        return out;
      });
      showCopy(
        "// Paste into src/shared/aquarium/scene/themes/nature-scape-sprites.ts's SPRITE_SCAPE, replacing placements:\\n" +
        "placements: " + serializeLiteral(literalPlacements) + ","
      );
      return;
    }
    const lines = SPRITE_COLOR_DEFAULTS
      .filter((c) => spriteColors[c.name] !== c.value)
      .map((c) => 'const ' + c.name + ' = "' + spriteColors[c.name] + '";');
    showCopy(lines.length ? lines.join("\\n") : "(no changes)");
    return;
  }
  if (activePart === "body") {
    const varName = bodyId.toUpperCase();
    showCopy(
      "// Paste into src/shared/aquarium/fish/body-profile.ts, replacing " + varName + ":\\n" +
      "const " + varName + ": BodyProfile = " + serializeLiteral(currentProfile()) + ";"
    );
    return;
  }
  const spec = currentFin(activePart);
  const target =
    activePart === "dorsal" ? "DORSAL_FIN." + dorsalId :
    activePart === "caudal" ? "CAUDAL_FIN." + tailId :
    activePart.toUpperCase().replace(/([A-Z])/g, "_$1").replace(/^_/, "") + "_FIN";
  showCopy(
    "// Paste into src/shared/aquarium/fish/fins.ts, replacing " + target + ":\\n" +
    serializeLiteral(spec) + ";"
  );
});

// Minimal literal serializer mirroring scripts/lib/design-serialize.ts's
// \`literal()\` (kept local since this tool's output shapes — a bare
// BodyProfile or FinSpec, not one big nested design object — differ enough
// that sharing the exact function isn't simpler than a small copy tuned for
// numeric-tuple rays).
function serializeLiteral(value, indent) {
  indent = indent || "";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === "number")) return "[" + value.map(String).join(", ") + "]";
    const inner = indent + "  ";
    return "[\\n" + value.map((v) => inner + serializeLiteral(v, inner) + ",").join("\\n") + "\\n" + indent + "]";
  }
  if (value && typeof value === "object") {
    const inner = indent + "  ";
    const entries = Object.entries(value).map(([k, v]) => inner + k + ": " + serializeLiteral(v, inner) + ",").join("\\n");
    return "{\\n" + entries + "\\n" + indent + "}";
  }
  return String(value);
}

document.getElementById("saveBtn").addEventListener("click", async () => {
  if (tab === "motion") {
    const changes = Object.fromEntries(Object.entries(swim).filter(([n, v]) => v !== swimInfo[n].value));
    if (Object.keys(changes).length === 0) { toast("No changes to save"); return; }
    const res = await fetch("/api/save-swim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ changes }),
    });
    const out = await res.json();
    if (res.ok) toast("Saved sim/swim.ts — run yarn verify:aquarium");
    else alert("Save failed: " + out.error);
    return;
  }

  if (tab === "sprites") {
    if (activeSpritesSection === "placements") {
      const changes = {};
      const additions = [];
      spritePlacements.forEach((p, i) => {
        if (isNewSpritePlacement(i)) {
          additions.push({ spriteId: p.spriteId, layer: p.layer, xFraction: p.xFraction, scale: p.scale, mirror: !!p.mirror });
        } else if (spritePlacementChangedFromDefault(p, i)) {
          changes[i] = { xFraction: p.xFraction, scale: p.scale, mirror: !!p.mirror };
        }
      });
      if (Object.keys(changes).length === 0 && additions.length === 0) { toast("No placement changes to save"); return; }
      const res = await fetch("/api/save-sprite-placements", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ changes, additions }),
      });
      const out = await res.json();
      if (res.ok) toast("Saved nature-scape-sprites.ts — run yarn verify:aquarium");
      else alert("Save failed: " + out.error);
      return;
    }
    const changes = {};
    for (const c of SPRITE_COLOR_DEFAULTS) {
      if (spriteColors[c.name] !== c.value) changes[c.name] = spriteColors[c.name];
    }
    if (Object.keys(changes).length === 0) { toast("No colour changes to save"); return; }
    const res = await fetch("/api/save-sprite-colors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ changes }),
    });
    const out = await res.json();
    if (res.ok) toast("Saved render/sprite-layers.tsx — run yarn verify:aquarium");
    else alert("Save failed: " + out.error);
    return;
  }

  if (activeSceneSection === "placements") {
    const changes = {};
    placements.forEach((p, i) => {
      if (placementChangedFromDefault(p, i)) {
        changes[p.seed] = { xFraction: p.xFraction, scale: p.scale, mirror: !!p.mirror };
      }
    });
    if (Object.keys(changes).length === 0) { toast("No placement changes to save"); return; }
    const res = await fetch("/api/save-placements", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ changes }),
    });
    const out = await res.json();
    if (res.ok) toast("Saved nature-scape.ts — run yarn verify:aquarium");
    else alert("Save failed: " + out.error);
    return;
  }

  const res = await fetch("/api/save-scene", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(sceneDesign),
  });
  const out = await res.json();
  if (res.ok) toast("Saved scene-design.ts — run yarn verify:aquarium");
  else alert("Save failed: " + out.error);
});

setTab("shape");
</script>
</body></html>`;
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/") {
    try {
      const swimConsts = readSwimConstants(readFileSync(SWIM_PATH, "utf8"));
      const placements = readPlacements(readFileSync(NATURE_SCAPE_PATH, "utf8"));
      const spritePlacements = readSpritePlacements(
        readFileSync(NATURE_SCAPE_SPRITES_PATH, "utf8"),
      );
      const spriteColors = readHexConstants(
        readFileSync(SPRITE_LAYERS_PATH, "utf8"),
        SPRITE_COLOR_NAMES,
      );
      const page = html(buildClient(), swimConsts, placements, spritePlacements, spriteColors);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(page);
    } catch (err) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(`Bundle failed:\n\n${(err as Error).message}`);
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/bake") {
    try {
      const body = (await readJson(req)) as {
        traits: FishTraits;
        stage: LifeStage;
        shape: ShapeState;
      };
      applyShapeState(body.shape);
      const Skia = await loadSkiaNode();
      const dpr = densityAwareDpr(2, 1.2);
      const baked = bakeFish(Skia, body.traits, body.stage ?? "adult", dpr);
      if (!baked) throw new Error("bakeFish returned null (bounds collapsed?)");
      const bytes = baked.image.encodeToBytes();
      const dataUri = `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ dataUri }));
    } catch (err) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/motion-bundle") {
    try {
      const body = (await readJson(req)) as { changes: Partial<Record<SwimConstName, number>> };
      const swimSource = readFileSync(SWIM_PATH, "utf8");
      const js = await buildMotionBundle(swimSource, body.changes);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ js }));
    } catch (err) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/save-swim") {
    try {
      const body = (await readJson(req)) as { changes: Partial<Record<SwimConstName, number>> };
      const current = readFileSync(SWIM_PATH, "utf8");
      writeFileSync(SWIM_PATH, patchSwimConstants(current, body.changes));
      console.log("Saved sim/swim.ts:", Object.keys(body.changes).join(", "));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/scene-render") {
    try {
      const body = (await readJson(req)) as {
        design: SceneDesign;
        placements: Record<number, PlacementChange>;
        width: number;
        height: number;
      };
      applySceneDesign(body.design);
      const { dataUri, pieces } = await renderScene(body.width, body.height, body.placements);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ dataUri, pieces }));
    } catch (err) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/save-scene") {
    try {
      const design = (await readJson(req)) as SceneDesign;
      const current = readFileSync(SCENE_DESIGN_PATH, "utf8");
      writeFileSync(SCENE_DESIGN_PATH, serializeSceneDesign(current, design));
      console.log("Saved scene-design.ts");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/save-placements") {
    try {
      const body = (await readJson(req)) as { changes: Record<number, PlacementChange> };
      const current = readFileSync(NATURE_SCAPE_PATH, "utf8");
      writeFileSync(NATURE_SCAPE_PATH, patchPlacements(current, body.changes));
      console.log("Saved nature-scape.ts placements:", Object.keys(body.changes).join(", "));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/sprite-render") {
    try {
      const body = (await readJson(req)) as {
        placements: Record<number, SpritePlacementChange>;
        additions?: NewSpritePlacement[];
        colors: Record<string, string>;
        width: number;
        height: number;
      };
      const { dataUri, pieces } = await renderSpriteScene(
        body.width,
        body.height,
        body.placements,
        body.colors,
        body.additions ?? [],
      );
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ dataUri, pieces }));
    } catch (err) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/save-sprite-placements") {
    try {
      const body = (await readJson(req)) as {
        changes: Record<number, SpritePlacementChange>;
        additions?: NewSpritePlacement[];
      };
      let current = readFileSync(NATURE_SCAPE_SPRITES_PATH, "utf8");
      current = patchSpritePlacements(current, body.changes);
      if (body.additions && body.additions.length > 0) {
        current = insertSpritePlacements(current, body.additions);
      }
      writeFileSync(NATURE_SCAPE_SPRITES_PATH, current);
      console.log(
        "Saved nature-scape-sprites.ts placements:",
        Object.keys(body.changes).join(", "),
        body.additions?.length ? `+${body.additions.length} new` : "",
      );
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/save-sprite-colors") {
    try {
      const body = (await readJson(req)) as { changes: Record<string, string> };
      const current = readFileSync(SPRITE_LAYERS_PATH, "utf8");
      writeFileSync(SPRITE_LAYERS_PATH, patchHexConstants(current, body.changes));
      console.log("Saved render/sprite-layers.tsx colours:", Object.keys(body.changes).join(", "));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Aquarium designer: http://127.0.0.1:${PORT}`);
  console.log("Shape tab: Copy-code only (body-profile.ts/fins.ts keep their inline comments).");
  console.log("Motion tab: Save writes src/shared/aquarium/sim/swim.ts directly.");
  console.log(
    "Scene tab: species/water/substrate/bubbles/layers save to scene-design.ts directly;",
  );
  console.log(
    "  placements save xFraction/scale/mirror in place, structural edits are Copy-code only.",
  );
  console.log(
    "Sprites tab: placements save to nature-scape-sprites.ts in place; colours save to render/sprite-layers.tsx directly.",
  );
});
