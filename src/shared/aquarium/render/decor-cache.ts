// React-side bake cache for scene decor pieces — same pattern as
// `fish-cache.ts`, but keyed by `PlacedPiece.bakeKey` (species + layer + seed
// + scale + attachment angle) since decor has no life-stage/trait axis to
// key on.

import { Skia } from "@shopify/react-native-skia";

import { bakeBytes, bakeNodes, createBakeLru, type BakedArt } from "@/shared/aquarium/core/bake";
import {
  DECOR_BUDGET_BYTES,
  DECOR_DPR_BY_LAYER,
  DECOR_PAD,
} from "@/shared/aquarium/core/decor-budget";
import { inflateBox } from "@/shared/aquarium/core/ir";

import { GENERATORS, type PlacedPiece } from "../scene/compose";

// Budget/DPR/pad live in `core/decor-budget.ts` so `verify-aquarium.ts` can
// check a theme's working set against the SAME numbers the app enforces —
// this module can't be imported under Node (the Skia root import above).
const lru = createBakeLru(DECOR_BUDGET_BYTES);

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
  const dpr = DECOR_DPR_BY_LAYER[piece.layer];
  const baked = bakeNodes(Skia, generated.nodes, bounds, dpr);
  if (baked) lru.set(piece.bakeKey, baked, bakeBytes(bounds, dpr));
  return baked;
}
