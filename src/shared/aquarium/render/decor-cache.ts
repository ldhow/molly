// React-side bake cache for scene decor pieces — same pattern as
// `fish-cache.ts`, but keyed by `PlacedPiece.bakeKey` (species + layer + seed
// + scale + attachment angle) since decor has no life-stage/trait axis to
// key on.

import { Skia } from "@shopify/react-native-skia";

import { bakeBytes, bakeNodes, createBakeLru, type BakedArt } from "@/shared/aquarium/core/bake";
import { inflateBox } from "@/shared/aquarium/core/ir";

import { GENERATORS, type PlacedPiece } from "../scene/compose";

const BUDGET_BYTES = 12 * 1024 * 1024;
const lru = createBakeLru(BUDGET_BYTES);
const DECOR_DPR = 2;
const DECOR_PAD = 6;

export function getCachedDecor(piece: PlacedPiece): BakedArt | null {
  const hit = lru.get(piece.bakeKey);
  if (hit) return hit;

  const generator = GENERATORS[piece.species];
  const attachTo =
    piece.attachAngleDeg !== undefined ? { x: 0, y: 0, angleDeg: piece.attachAngleDeg } : undefined;
  const generated = generator({
    seed: piece.seed,
    scale: piece.scale,
    attachTo,
    mirror: piece.mirror,
  });
  const bounds = inflateBox(generated.bbox, DECOR_PAD);
  const baked = bakeNodes(Skia, generated.nodes, bounds, DECOR_DPR);
  if (baked) lru.set(piece.bakeKey, baked, bakeBytes(bounds, DECOR_DPR));
  return baked;
}
