// Browser-bundled entry point for `aquarium-design-editor.ts`'s Shape tab.
//
// Deliberately thin: `fish/profile.ts`'s `pchip` and `fish/fins.ts`'s
// `buildFin` are already pure, dependency-free, and exactly what
// `fish/anatomy.ts` calls in production, so this file just re-exposes them
// plus the two small pieces of glue `anatomy.ts` does inline (turning a
// `BodyProfile` into the `Curve1D` pair + context `buildFin` needs) — no
// separate reimplementation of body/fin geometry to drift out of sync with
// the real bake.
import { FIN_REF_HALF_HEIGHT, FIN_SCALE_BY_BODY } from "../../src/shared/aquarium/fish/anatomy";
import type { BodyProfile } from "../../src/shared/aquarium/fish/body-profile";
import { buildFin, type FinBuildContext } from "../../src/shared/aquarium/fish/fins";
import { linspace, pchip, type CurvePoint } from "../../src/shared/aquarium/fish/profile";
import type { BodyId } from "../../src/shared/fish/types";

export { buildFin };
export type { FinBuildContext };

export interface BodyCurveSample {
  top: CurvePoint[];
  bottom: CurvePoint[];
}

/** Body outline as absolute (x,y) points in the profile's own local frame — `x0 + u*length` horizontally, `±half-height` vertically, matching `anatomy.ts`'s `topPass`/`bottomPass`. */
export function sampleBodyCurve(profile: BodyProfile, samples = 90): BodyCurveSample {
  const top = pchip(profile.top);
  const bottom = pchip(profile.bottom);
  const xAt = (u: number) => profile.x0 + u * profile.length;
  return {
    top: linspace(0, 1, samples).map((u) => ({ x: xAt(u), y: -top(u) })),
    bottom: linspace(0, 1, samples).map((u) => ({ x: xAt(u), y: bottom(u) })),
  };
}

/** The same `FinBuildContext` `anatomy.ts` builds for `buildFin` — same fixed fin-size reference, same per-body scale, so an edited fin previews at the exact size it would bake at. */
export function finContextFor(profile: BodyProfile, body: BodyId): FinBuildContext {
  const baseTop = pchip(profile.top);
  const baseBottom = pchip(profile.bottom);
  return {
    x0: profile.x0,
    length: profile.length,
    halfHeight: FIN_REF_HALF_HEIGHT * FIN_SCALE_BY_BODY[body],
    baseTop,
    baseBottom,
    peduncleMidY: (baseBottom(1) - baseTop(1)) / 2,
  };
}
