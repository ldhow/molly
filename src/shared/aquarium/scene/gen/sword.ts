// Sword plant (cỏ lá hán): a bold mid-ground rosette — a handful of long,
// arching, lance-shaped leaves radiating from a low crown, always rooted in
// the substrate (never mounted, unlike `anubias`'s epiphyte leaves). Reads
// as a genuine centrepiece plant, not filler: roughly double `anubias`'s
// leaf reach, a narrower lance-blade ratio instead of a spade, and a
// brighter mid-tone for a bolder read. The fan stays closer to upright than
// anubias's — this species gets placed right at the swim-lane edge in
// `nature-scape.ts`, and leaves splayed much past ~35° off vertical reach
// sideways into the lane rather than up.
//
// Local space: origin at the crown (substrate line), +y down — same
// convention as the rest of the tree.

import type { Node, XY } from "@/shared/aquarium/core/ir";
import { unionBox } from "@/shared/aquarium/core/ir";
import { DEFAULT_SCENE_DESIGN } from "@/shared/aquarium/scene/scene-design";
import type { Generator } from "@/shared/aquarium/scene/types";
import { lighten } from "@/shared/lib/color";
import { makeRng } from "@/shared/lib/rng";

import { contactShadow, depthShade, specularStreak, translucency } from "./depth";
import { ribbonFold, ribbonPath, spinePath } from "./ribbon";
import { lateralVeins } from "./texture";

const DESIGN = DEFAULT_SCENE_DESIGN.species.sword;
const LIGHT = DEFAULT_SCENE_DESIGN.lighting;

/** A long arching lance leaf: grows outward, then droops in its outer third — the silhouette a straight spade leaf (anubias.ts) doesn't have. */
function leafSpine(leafLen: number, rad: number, droop: number): XY[] {
  const dirX = Math.cos(rad);
  const dirY = Math.sin(rad);
  return [
    { x: 0, y: 0 },
    { x: dirX * leafLen * 0.4, y: dirY * leafLen * 0.4 },
    { x: dirX * leafLen * 0.85 + droop * 0.5, y: dirY * leafLen * 0.85 + droop * 0.3 },
    { x: dirX * leafLen + droop * 1.6, y: dirY * leafLen + droop },
  ];
}

export const generateSwordPlant: Generator = ({ seed, scale }) => {
  // Read at call time — see anubias.ts's identical note on why.
  const LEAF_DARK = DESIGN.leafDarkColor;
  const LEAF_MID = DESIGN.leafMidColor;
  const LEAF_TIP = lighten(LEAF_MID, DESIGN.leafTipLighten);
  const LEAF_VEIN = DESIGN.veinColor;
  const rng = makeRng(`sword-${seed}`);
  const leafCount = DESIGN.leafCountMin + Math.floor(rng() * DESIGN.leafCountRange);
  const nodes: Node[] = [
    { kind: "circle", cx: 0, cy: 0, r: 4 * scale, paint: { type: "solid", color: LEAF_DARK } },
  ];
  let bbox = { x: -6 * scale, y: -6 * scale, width: 12 * scale, height: 12 * scale };

  for (let i = 0; i < leafCount; i++) {
    const spread = (i - (leafCount - 1) / 2) * (DESIGN.spreadMin + rng() * DESIGN.spreadRange);
    const angleDeg = -90 + spread + (rng() - 0.5) * DESIGN.angleJitter;
    const rad = (angleDeg * Math.PI) / 180;
    const leafLen = (DESIGN.leafLenMin + rng() * DESIGN.leafLenRange) * scale;
    const leafWidth = leafLen * (DESIGN.leafWidthFactorMin + rng() * DESIGN.leafWidthFactorRange);
    const droop = (DESIGN.droopMin + rng() * DESIGN.droopRange) * scale;
    // Phase for the margin ripple below — one draw per leaf, so the notches
    // along the edge don't line up leaf to leaf the way a shared phase would.
    const ripplePhase = rng() * Math.PI * 2;
    const spine = leafSpine(leafLen, rad, droop);
    const tip = spine[spine.length - 1];

    // Outer leaves of the rosette turn away from the viewer, so depth runs
    // from the centre of the fan outward — the same rule `anubias.ts` uses,
    // and for the same reason: without it the crown is flat paper. Computed
    // before `widthAt` because it now feeds a NARROWING term too — a leaf
    // that's turned away doesn't just get darker, it also foreshortens
    // (real width narrows as an edge turns from the camera), and darkening
    // alone is what left the rosette reading as a flat paper fan even after
    // the depth ordering was in place.
    const fromCentre =
      leafCount > 1 ? Math.abs(i - (leafCount - 1) / 2) / ((leafCount - 1) / 2) : 0;
    const depth = fromCentre * 0.8;
    const narrow = 1 - depth * 0.32;

    // Not `sin(t*pi)`: the widest point sits at 36% up the blade rather than
    // the middle (a lance, not a symmetric lens), and a low-frequency ripple
    // rides the margin — real sword-plant leaves are named for that undulate
    // edge, and a clean sine silhouette has no way to show it.
    const widthAt = (t: number) => {
      if (t <= 0 || t >= 1) return 0;
      const peak = 0.36;
      const base =
        t < peak
          ? Math.sin((t / peak) * Math.PI * 0.5)
          : Math.cos(((t - peak) / (1 - peak)) * Math.PI * 0.5) ** 0.78;
      const ripple =
        1 +
        0.09 * Math.sin(t * 9 + ripplePhase) +
        0.04 * Math.sin(t * 21 + ripplePhase * 2.3);
      return leafWidth * base * ripple * narrow * (1 - t * 0.1);
    };

    // Two fills instead of one gradient across the whole blade — the fold at
    // the midrib, as two surfaces meeting at an angle rather than one curved
    // one. See `ribbonFold`'s doc for why the two halves agree at the crease
    // (`offset 0`) and only diverge outward.
    const fold = ribbonFold(spine, widthAt, { x: LIGHT.dirX, y: LIGHT.dirY });
    nodes.push({
      kind: "path",
      d: fold.litPath,
      paint: {
        type: "linear",
        from: fold.litAxis.from,
        to: fold.litAxis.to,
        stops: [
          { offset: 0, color: depthShade(LEAF_DARK, depth) },
          { offset: 0.55, color: depthShade(LEAF_MID, depth * 0.7) },
          { offset: 1, color: depthShade(LEAF_TIP, depth * 0.5) },
        ],
      },
    });
    nodes.push({
      kind: "path",
      d: fold.shadowPath,
      paint: {
        type: "linear",
        from: fold.shadowAxis.from,
        to: fold.shadowAxis.to,
        stops: [
          { offset: 0, color: depthShade(LEAF_DARK, depth) },
          { offset: 1, color: depthShade(LEAF_MID, Math.min(1, depth * 1.25 + 0.18)) },
        ],
      },
    });

    nodes.push(lateralVeins(spine, widthAt, LEAF_VEIN, 0.26));
    // The backlight glow — most visible on leaves that are still mostly
    // facing the viewer, the same population the specular below is limited
    // to and for the same reason.
    if (depth < 0.6) {
      nodes.push(
        translucency(
          ribbonPath(spine, widthAt),
          spine,
          widthAt,
          lighten(LEAF_TIP, 0.55),
          0.17 * (1 - depth),
        ),
      );
    }
    // Front leaves only — see `plants.ts` for why a glint on a shaded leaf
    // undoes the depth ordering it sits inside.
    if (depth < 0.45) {
      nodes.push(
        specularStreak(
          spine,
          widthAt,
          { x: LIGHT.dirX, y: LIGHT.dirY },
          lighten(LEAF_MID, 0.6),
          0.32 * (1 - depth * 2.2),
        ),
      );
    }
    nodes.push({
      kind: "path",
      d: spinePath(spine),
      paint: { type: "solid", color: LEAF_VEIN, opacity: 0.5 },
      stroke: { width: 1 * scale },
    });

    const reach = leafLen + leafWidth / 2;
    bbox = unionBox(bbox, {
      x: tip.x - reach,
      y: tip.y - reach,
      width: reach * 2,
      height: reach * 2,
    });
  }

  return {
    nodes: [contactShadow(0, (DESIGN.leafLenMin * 0.5 + 6) * scale, 0.24), ...nodes],
    bbox,
    anchors: [],
    swayHeight: DESIGN.swayHeightFactor * scale,
  };
};
