// The axolotl's body volume, for the relight pass in `core/sksl/warp.ts`.
//
// This is the ONLY creature that gets one, and the reason is not favouritism
// — it is the only species for which both halves of the pass already apply.
// It is the only creature that spine-warps at all (`locomotion:
// "undulating"`, see `render/creature-layer.tsx`), so it is the only one
// drawn through the shader that does the lighting; and it is the only one
// authored with `fish/profile.ts`'s `baseTop`/`baseBottom` pchip pair rather
// than its own bespoke geometry (see this folder's `anatomy.ts` header, which
// calls that out explicitly), so it is the only one the elliptical
// cross-section model in `fish/normal-map.ts` can describe without inventing
// a shape.
//
// The other four (otter, turtle, shrimp, snail) render as a plain `<Image>`
// with no shader in the path at all, and their anatomy is per-species
// silhouette work with no shared half-height curve. Relighting them is a real
// piece of art+geometry work per species, not an extension of this file.
//
// Dependency-free apart from the shared model: no React/RN/Skia. Runs under
// plain Node for `scripts/verify-aquarium.ts`.

import type { Box } from "@/shared/aquarium/core/ir";
import { linspace } from "@/shared/aquarium/fish/profile";
import type { BodyVolume } from "@/shared/aquarium/fish/normal-map";

import { buildAxolotlAnatomy } from "./anatomy";

/**
 * A salamander is far rounder in section than a molly — near-cylindrical
 * through the trunk rather than the deep, laterally-compressed blade a
 * cichlid-shaped fish is. Hence a much higher ratio than molly's 0.62.
 */
const LATERAL_RATIO = 0.78;

/** An axolotl's head is broad and flat-topped, and keeps most of its width right to the snout. */
const NOSE_TAPER_FLOOR = 0.72;

/**
 * The paddle tail is the one place the axolotl is FLATTER than the molly: it
 * is a vertical fin-blade continuous with the trunk, so it loses more of its
 * width than a caudal peduncle does even though the profile is flaring OUT in
 * height there at the same time.
 */
const TAIL_TAPER_DEPTH = 0.66;

/**
 * Body-only bbox from the profile curves, deliberately NOT
 * `AxolotlAnatomy.bounds` — that box includes the gill fronds and the four leg
 * stubs, which stick well clear of the trunk. Sizing the map to it would spend
 * most of its pixels on empty space around limbs that are flat membranes with
 * no volume to light.
 */
function bodyBoxOf(anatomy: ReturnType<typeof buildAxolotlAnatomy>): Box {
  const us = linspace(0, 1, 96);
  let top = Infinity;
  let bottom = -Infinity;
  for (const u of us) {
    top = Math.min(top, -anatomy.baseTop(u));
    bottom = Math.max(bottom, anatomy.baseBottom(u));
  }
  return {
    x: anatomy.x0,
    y: top,
    width: anatomy.length,
    height: bottom - top,
  };
}

/**
 * Deterministic and variant-blind — every axolotl variant shares one body
 * (see `anatomy.ts`'s `buildAxolotlAnatomy`, which takes no arguments), and
 * creatures have no life-stage squish, so ONE map serves every axolotl in
 * every tank.
 */
export function axolotlVolume(): BodyVolume {
  const anatomy = buildAxolotlAnatomy();
  return {
    baseTop: anatomy.baseTop,
    baseBottom: anatomy.baseBottom,
    x0: anatomy.x0,
    length: anatomy.length,
    bodyBox: bodyBoxOf(anatomy),
    // Creatures are baked without `STAGE_SQUISH` — `bakeCreature` takes no
    // life stage at all.
    squish: 1,
    lateralRatio: LATERAL_RATIO,
    noseTaperFloor: NOSE_TAPER_FLOOR,
    tailTaperDepth: TAIL_TAPER_DEPTH,
    // The paddle tail IS this profile — it flares out at u=1 and is closed by
    // `anatomy.ts`'s `roundCapPoints`, so there is no separate shape taking
    // over and nothing to hide a seam behind. Feathering here would simply
    // switch the lighting off across the most mobile part of the animal.
    featherTail: false,
  };
}
