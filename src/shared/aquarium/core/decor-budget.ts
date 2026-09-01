// Bake-cache budget for scene decor, split out of `render/decor-cache.ts` so
// Node can read it: that file imports `{ Skia }` from
// `@shopify/react-native-skia`'s root at module scope, which pulls in the
// native module and blows up under plain Node. `scripts/verify-aquarium.ts`
// needs these three numbers to check a theme's working set against the same
// budget the app enforces, so they live here — dependency-free, next to
// `bake.ts`, which verify already imports.
//
// The failure mode this exists to police is invisible: `getCachedDecor` bakes
// SYNCHRONOUSLY inside render, so a theme whose distinct `bakeKey`s don't all
// fit in the budget re-bakes evicted pieces every frame. That reads as a
// permanently low frame rate with no visual artifact to bisect from.

export const DECOR_BUDGET_BYTES = 12 * 1024 * 1024;
export const DECOR_PAD = 6;

/**
 * Bake resolution per depth band. Bytes go as DPR SQUARED, and the two back
 * bands are where nearly all of a theme's pixels live — they hold the tall
 * planting, and `scene/backdrop.ts` puts most of its pieces there.
 *
 * They're also the bands nobody can inspect: `render/scene-layers.tsx` draws
 * `far` at 0.45 opacity and `back` at 0.7, both behind every fish, both
 * drifting under parallax. Baking them at the same fidelity as a foreground
 * stone that sits against the glass spends ~2x the bytes on the half of the
 * scene that is deliberately out of focus — and the budget it wastes is
 * exactly the budget a densely-planted background needs.
 *
 * Safe to key off the layer because `compose.ts`'s `bakeKey` includes the
 * layer, so a piece can never be looked up at a DPR it wasn't baked at.
 */
// The 3 extra depth tiers ("backMid"/"frontMid"/"frontMost" — see
// `scene/types.ts`'s `SceneLayer` doc) are decor-tier-only: the PROCEDURAL
// theme this budget polices never places anything there, only the authored
// far/back/mid/front. Included here purely so this stays indexable by the
// full `SceneLayer` type; their values are never exercised in practice.
export const DECOR_DPR_BY_LAYER: Record<
  "far" | "back" | "backMid" | "mid" | "frontMid" | "front" | "frontMost",
  number
> = {
  far: 1.4,
  back: 1.5,
  backMid: 1.75,
  mid: 2,
  frontMid: 2,
  front: 2,
  frontMost: 2,
};
