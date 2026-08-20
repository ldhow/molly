// Turns an authored `SceneTheme` (normalized placements) into concrete,
// positioned pieces: resolves `attachToId` references onto their target's
// anchors, and converts each placement's `xFraction` into an actual pixel
// base position for a given canvas size.
//
// Dependency-free: no React/RN/Skia. `render/scene-layers.tsx` bakes and
// draws what this produces.

import { generateAnubias } from "./gen/anubias";
import { generateBloom } from "./gen/bloom";
import { generateCabomba } from "./gen/cabomba";
import { generateCarpet } from "./gen/carpet";
import { generateDriftwood } from "./gen/driftwood";
import { generateKelp } from "./gen/kelp";
import { generateRotala, generateStemBush, generateVallisneria } from "./gen/plants";
import { generateSeiryuStone } from "./gen/rock";
import { generatePebbles, generateSubstrateMound } from "./gen/substrate";
import { generateSwordPlant } from "./gen/sword";
import type { Anchor, Generator, SceneLayer, SceneTheme, SpeciesId } from "./types";

const GENERATORS: Record<SpeciesId, Generator> = {
  driftwood: generateDriftwood,
  anubias: generateAnubias,
  vallisneria: generateVallisneria,
  stemBush: generateStemBush,
  seiryuStone: generateSeiryuStone,
  substrateMound: generateSubstrateMound,
  pebbles: generatePebbles,
  kelp: generateKelp,
  bloom: generateBloom,
  cabomba: generateCabomba,
  sword: generateSwordPlant,
  carpet: generateCarpet,
  rotala: generateRotala,
};

export interface PlacedPiece {
  key: string;
  species: SpeciesId;
  layer: SceneLayer;
  /** World pixel position of this piece's own local origin (its base). */
  worldX: number;
  worldY: number;
  seed: number;
  scale: number;
  swayHeight: number;
  /** The generated art's own local-space bbox (origin at `worldX/worldY`). Purely informational for renderers — `sim/crawl.ts` uses it to know how tall a piece a snail can climb. */
  bbox: { x: number; y: number; width: number; height: number };
  bakeKey: string;
  /** Resolved attachment angle (if this placement had `attachToId`) — needed to regenerate identical art at bake time. */
  attachAngleDeg?: number;
  mirror?: boolean;
}

export interface ComposedScene {
  pieces: PlacedPiece[];
  swimLaneRects: { x: number; width: number }[];
}

/**
 * Decor pieces are authored (and generated) at a fixed pixel scale — the
 * theme's `xFraction`s were tuned against a canvas around this wide. Without
 * this, the SAME absolute-size driftwood cluster that sits comfortably clear
 * of the swim lane on a landscape-ish canvas floods a narrow portrait one
 * (the dominant orientation for this app's Tank screen), since its footprint
 * stays fixed in pixels while the canvas — and the lane carved out of it —
 * shrinks. Clamped so it never grows decor much past its authored size on a
 * wide canvas either.
 *
 * Height factors in too, not just width: on a short landscape canvas the
 * water column itself is the binding constraint, not canvas width — a
 * driftwood piece scaled for a ~800px-tall portrait column reaches branches
 * well past its base on a ~330px-tall one (taller trunk = longer branches =
 * more horizontal spread from the same lean angle), which measurably
 * intruded into the swim lane at 844x390 before this was added (column-
 * occupancy check in verify-aquarium.ts). Taking the min of the two factors
 * means portrait (taller than wide) stays width-bound exactly as before —
 * this only pulls landscape down.
 */
const REFERENCE_WIDTH = 700;
const REFERENCE_HEIGHT = 800;
const MIN_SIZE_FACTOR = 0.6;
const MAX_SIZE_FACTOR = 1.2;

export function sizeFactorFor(canvasWidth: number, canvasHeight: number): number {
  const widthFactor = canvasWidth / REFERENCE_WIDTH;
  const heightFactor = canvasHeight / REFERENCE_HEIGHT;
  return Math.min(MAX_SIZE_FACTOR, Math.max(MIN_SIZE_FACTOR, Math.min(widthFactor, heightFactor)));
}

/**
 * `xFraction`/`yFraction` are normalized to canvas size; `substrateY` is
 * where decor bases sit (the top of the sand band).
 */
export function composeScene(
  theme: SceneTheme,
  canvasWidth: number,
  canvasHeight: number,
  substrateY: number,
): ComposedScene {
  const sizeFactor = sizeFactorFor(canvasWidth, canvasHeight);
  const anchorsById = new Map<
    string,
    { anchors: Anchor[]; worldX: number; worldY: number; scale: number }
  >();
  const pieces: PlacedPiece[] = [];

  for (const placement of theme.placements) {
    const generator = GENERATORS[placement.species];
    const scale = placement.scale * sizeFactor;
    let worldX = placement.xFraction * canvasWidth;
    let worldY = substrateY;
    let attachTo: Anchor | undefined;

    if (placement.attachToId) {
      const target = anchorsById.get(placement.attachToId);
      const anchor = target?.anchors[placement.anchorIndex ?? 0];
      if (target && anchor) {
        worldX = target.worldX + anchor.x * target.scale;
        worldY = target.worldY + anchor.y * target.scale;
        attachTo = { x: 0, y: 0, angleDeg: anchor.angleDeg };
      }
    }

    const generated = generator({
      seed: placement.seed,
      scale,
      attachTo,
      mirror: placement.mirror,
    });
    if (placement.id) {
      anchorsById.set(placement.id, { anchors: generated.anchors, worldX, worldY, scale });
    }

    pieces.push({
      key: `${placement.species}-${placement.id ?? pieces.length}`,
      species: placement.species,
      layer: placement.layer,
      worldX,
      worldY,
      seed: placement.seed,
      scale,
      swayHeight: generated.swayHeight,
      bbox: generated.bbox,
      bakeKey: `${placement.species}|${placement.layer}|${placement.seed}|${scale.toFixed(3)}|${attachTo ? attachTo.angleDeg.toFixed(1) : "planted"}|${placement.mirror ? "mirror" : "plain"}`,
      attachAngleDeg: attachTo?.angleDeg,
      mirror: placement.mirror,
    });
  }

  const swimLaneRects = theme.swimLanes.map((lane) => ({
    x: lane.xFraction[0] * canvasWidth,
    width: (lane.xFraction[1] - lane.xFraction[0]) * canvasWidth,
  }));

  return { pieces, swimLaneRects };
}

export { GENERATORS };
