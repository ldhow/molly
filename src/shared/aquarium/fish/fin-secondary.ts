// Derives `spine.ts`'s `FinPivot`s from already-computed fin geometry — kept
// separate from `spine.ts` itself so that file stays free of `FishFins`/
// `anatomy.ts` imports (it's dependency-free by design, consumed by the
// SkSL warp's numeric-agreement check under plain Node).
//
// Dependency-free: no React/RN/Skia.

import type { FinPivot } from "./spine";
import type { FishFins } from "./anatomy";
import type { FinShape } from "./fins";

/**
 * Falloff margin past the fin's own hub-to-tip extent, as a multiplier —
 * the rotation should stay at full amplitude across the WHOLE visible fin
 * (a rigid scull, not a fin that only rotates near its own root), easing to
 * identity somewhat past its tip so the transition lands in open water /
 * the body's own texture rather than visibly clipping the fin shape itself.
 * 1.4 is a starting point, not measured — re-check once fins/tail are
 * re-proportioned (Part D of the "update 2d fish v2" plan).
 */
const FALLOFF_MARGIN = 1.4;

function pivotFor(fin: FinShape): FinPivot {
  const left = fin.pivot.x - fin.bbox.x;
  const right = fin.bbox.x + fin.bbox.width - fin.pivot.x;
  const top = fin.pivot.y - fin.bbox.y;
  const bottom = fin.bbox.y + fin.bbox.height - fin.pivot.y;
  return {
    x: fin.pivot.x,
    n: fin.pivot.y,
    radiusX: Math.max(left, right, 1) * FALLOFF_MARGIN,
    radiusN: Math.max(top, bottom, 1) * FALLOFF_MARGIN,
  };
}

/** Pivots for the three fins that get independent secondary motion — see `render/fish-layer.tsx`. */
export function finPivotsFor(fins: FishFins): {
  pecNear: FinPivot;
  pecFar: FinPivot;
  caudal: FinPivot;
} {
  return {
    pecNear: pivotFor(fins.pectoralNear),
    pecFar: pivotFor(fins.pectoralFar),
    caudal: pivotFor(fins.caudal),
  };
}
