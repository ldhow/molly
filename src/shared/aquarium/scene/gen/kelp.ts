// Tall kelp: a few broad, dark, low-detail fronds reaching well up into the
// frame. Deliberately a SILHOUETTE piece, not a detailed plant — it exists to
// frame the tank's edges and give the scene depth (the reference background's
// dark kelp walls on both sides), so it reads as a shape against the light
// rather than as foliage you inspect. `rock.ts`'s note that hardscape "should
// read as silhouette, not detail" applies here for the same reason.
//
// Distinct from `vallisneria` (thin grass blades, mid-green, background
// filler): kelp fronds are ~5x wider, much darker, and much taller, and they
// carry a slight edge ripple so a wide frond doesn't read as a flat plank.
//
// Local space: origin at the base, +y down, fronds growing to -y.

import type { Node, XY } from "@/shared/aquarium/core/ir";
import { unionBox } from "@/shared/aquarium/core/ir";
import { DEFAULT_SCENE_DESIGN } from "@/shared/aquarium/scene/scene-design";
import type { Generator } from "@/shared/aquarium/scene/types";
import { darken, lighten } from "@/shared/lib/color";
import { makeRng } from "@/shared/lib/rng";

import { contactShadow, depthShade } from "./depth";
import { ribbonCrossAxis, ribbonPath } from "./ribbon";

const DESIGN = DEFAULT_SCENE_DESIGN.species.kelp;
const LIGHT = DEFAULT_SCENE_DESIGN.lighting;

export const generateKelp: Generator = ({ seed, scale, mirror }) => {
  // Read at call time — see anubias.ts's identical note on why. Dark, cool,
  // low-saturation — these sit in shadow at the tank's edges.
  const FROND_COLORS = [DESIGN.color1, DESIGN.color2, DESIGN.color3];
  const rng = makeRng(`kelp-${seed}`);
  const dir = mirror ? -1 : 1;
  const frondCount = DESIGN.frondCountMin + Math.floor(rng() * DESIGN.frondCountRange);
  const nodes: Node[] = [];
  let bbox = { x: 0, y: 0, width: 1, height: 1 };

  for (let i = 0; i < frondCount; i++) {
    // Tall on purpose — see `KelpDesign.heightMin`'s doc comment in
    // scene-design.ts: `compose.ts`'s `sizeFactorFor` clamps decor scale, so
    // these numbers are chosen POST-clamp to actually reach near the top of
    // frame — don't tune them against the raw value.
    const height = (DESIGN.heightMin + rng() * DESIGN.heightRange) * scale;
    // Fronds fan outward from the base, leaning away from the tank centre so
    // an edge-placed clump frames the scene instead of leaning into it.
    const lean = dir * (DESIGN.leanMin + rng() * DESIGN.leanRange) * scale;
    const curve = dir * (DESIGN.curveMin + rng() * DESIGN.curveRange) * scale;
    const baseX = dir * (i - (frondCount - 1) / 2) * 9 * scale;
    const spine: XY[] = [
      { x: baseX, y: 0 },
      { x: baseX + lean * 0.35, y: -height * 0.34 },
      { x: baseX + lean + curve * 0.5, y: -height * 0.7 },
      { x: baseX + lean + curve, y: -height },
    ];
    // Wide at the base, tapering but never to a point — a kelp blade ends
    // bluntly, unlike a grass tip. Broad on purpose — see `KelpDesign.widthMin`'s doc.
    const width = (DESIGN.widthMin + rng() * DESIGN.widthRange) * scale;
    const widthAt = (t: number) => width * (1 - t * 0.55) * (1 + 0.12 * Math.sin(t * 9));
    const d = ribbonPath(spine, widthAt);
    // Fronds are emitted back-to-front, so the first drawn is the deepest.
    // A kelp clump is broad and heavily overlapping, which makes it the piece
    // where uniform brightness reads worst — see `depth.ts`.
    const depth = frondCount > 1 ? 1 - i / (frondCount - 1) : 0;
    const color = depthShade(FROND_COLORS[i % FROND_COLORS.length], depth);
    // Shade ACROSS the frond, not along it. This used to be a base-to-tip
    // gradient, which is the wrong axis: a frond's length already reads
    // through its taper and curve, so a gradient there is invisible, while
    // its width is what tells you the blade is a curved surface rather than
    // a cutout. A frond this broad is the piece that most needed it.
    const cross = ribbonCrossAxis(spine, widthAt, { x: LIGHT.dirX, y: LIGHT.dirY });
    nodes.push({
      kind: "path",
      d,
      paint: {
        type: "linear",
        from: cross.from,
        to: cross.to,
        // The base colour sits off-centre (0.62, not 0.5) so the shaded side
        // occupies more of the blade than the lit side — light falls off
        // faster than it builds, and an evenly-split blade reads mechanical.
        stops: [
          { offset: 0, color: darken(color, LIGHT.formDarken) },
          { offset: 0.62, color },
          { offset: 1, color: lighten(color, LIGHT.formLighten) },
        ],
        opacity: 0.95,
      },
    });
    // A single lighter midrib — the cheapest thing that stops a wide dark
    // ribbon reading as a flat cutout.
    nodes.push({
      kind: "path",
      d: ribbonPath(spine, () => width * 0.13),
      paint: { type: "solid", color: lighten(color, 0.24), opacity: 0.4 },
    });
    bbox = unionBox(bbox, {
      x: baseX + Math.min(0, lean + curve) - width,
      y: -height,
      width: Math.abs(lean + curve) + width * 2,
      height,
    });
  }

  return {
    nodes: [contactShadow(0, (DESIGN.widthMin + DESIGN.widthRange) * scale * 1.6, 0.24), ...nodes],
    bbox,
    anchors: [],
    swayHeight: DESIGN.swayHeightFactor * scale,
  };
};
