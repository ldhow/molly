// Seiryu-style stone: an angular, jagged boulder sitting on the substrate.
// Local space: origin at the base CENTER (bottom edge on y=0), extending
// upward (-y).

import type { Node, XY } from "@/shared/aquarium/core/ir";
import { DEFAULT_SCENE_DESIGN } from "@/shared/aquarium/scene/scene-design";
import type { Generator } from "@/shared/aquarium/scene/types";
import { makeRng } from "@/shared/lib/rng";

import { contactShadow } from "./depth";
import { crackLines, grainSpeckles, mottlePatches } from "./texture";

const DESIGN = DEFAULT_SCENE_DESIGN.species.seiryuStone;

const F = (n: number) => n.toFixed(1);

function polygonD(points: readonly XY[]): string {
  let d = `M ${F(points[0].x)} ${F(points[0].y)}`;
  for (let i = 1; i < points.length; i++) d += ` L ${F(points[i].x)} ${F(points[i].y)}`;
  return d + " Z";
}

export const generateSeiryuStone: Generator = ({ seed, scale }) => {
  // Read at call time — see anubias.ts's identical note on why.
  const STONE_DARK = DESIGN.darkColor;
  const STONE_MID = DESIGN.midColor;
  const STONE_LIGHT = DESIGN.lightColor;
  const rng = makeRng(`seiryu-${seed}`);
  const width = (DESIGN.widthMin + rng() * DESIGN.widthRange) * scale;
  const height = (DESIGN.heightMin + rng() * DESIGN.heightRange) * scale;
  const vertexCount = DESIGN.vertexCountMin + Math.floor(rng() * DESIGN.vertexCountRange);

  // Jagged silhouette: for each angle around the base-anchored ellipse,
  // perturb the radius so facets read as angular rock, not a smooth blob —
  // the bottom stays flat-ish (small perturbation) so it looks grounded.
  const points: XY[] = [];
  for (let i = 0; i < vertexCount; i++) {
    const t = i / vertexCount;
    const angle = Math.PI + t * Math.PI; // sweep the TOP half only (0..π above the base line)
    const bottomFlatten = Math.sin(t * Math.PI); // 0 at the two base corners, 1 at the apex
    const jitter = DESIGN.jitterMin + rng() * DESIGN.jitterRange;
    const rx = (width / 2) * jitter;
    // `|sin(angle)|` ALREADY traces the dome from base corner to apex and
    // back. Multiplying that by `bottomFlatten` (which is the same hump)
    // squared the falloff, and squaring a dome is what turned every stone
    // into a TRIANGLE — the shape the sprite art never has. Kept as a light
    // 0.82..1 term so the base corners still tuck in slightly rather than
    // meeting the sand at a full-height vertical wall.
    const ry = height * jitter * (0.82 + 0.18 * bottomFlatten);
    points.push({ x: Math.cos(angle) * rx, y: -Math.abs(Math.sin(angle)) * ry });
  }
  // Close along the base.
  points.push({ x: width / 2, y: 0 });
  points.unshift({ x: -width / 2, y: 0 });

  const d = polygonD(points);
  const apex = points.reduce((a, b) => (b.y < a.y ? b : a));

  // Interior facets: seiryu stone reads as angular rock planes, not a smooth
  // boulder — a few seam lines from an upper vertex down to the base center,
  // each paired with a triangular light/dark wedge so adjacent faces catch
  // the (implied) light differently.
  const facetCount = DESIGN.facetCountMin + Math.floor(rng() * DESIGN.facetCountRange);
  const facetNodes: Node[] = [];
  const interior = points.slice(1, points.length - 1); // exclude the two base corners
  for (let f = 0; f < facetCount && interior.length > 0; f++) {
    const vi = interior[Math.floor(rng() * interior.length)];
    const neighborIdx = Math.max(
      0,
      Math.min(interior.length - 1, points.indexOf(vi) - 1 + Math.floor(rng() * 3) - 1),
    );
    const neighbor = interior[neighborIdx] ?? vi;
    const wedgeD = `M ${F(vi.x)} ${F(vi.y)} L ${F(neighbor.x)} ${F(neighbor.y)} L 0 0 Z`;
    const lighter = rng() > 0.5;
    facetNodes.push({
      kind: "path",
      d: wedgeD,
      blend: lighter ? "screen" : "multiply",
      paint: { type: "solid", color: lighter ? STONE_LIGHT : STONE_DARK, opacity: 0.18 },
    });
    facetNodes.push({
      kind: "path",
      d: `M ${F(vi.x)} ${F(vi.y)} L 0 0`,
      paint: { type: "solid", color: DESIGN.seamColor, opacity: 0.3 },
      stroke: { width: 0.9 },
    });
  }

  // ---------------------------------------------------------------------
  // Moss cap
  // ---------------------------------------------------------------------
  // Built as overlapping blobs CLIPPED to the stone silhouette, rather than
  // as its own outline path. Two reasons, both learned from the sprite art:
  // the moss edge there is lumpy and irregular (a single smooth boundary
  // reads as a painted stripe), and clipping guarantees the moss can never
  // spill past the rock no matter how the jittered silhouette came out.
  //
  // Each blob is centred slightly ABOVE the silhouette point it belongs to,
  // so the crown is solidly covered and only the blobs' lower arcs show as
  // the scalloped moss line.
  const mossTop = apex.y;
  const mossLine = mossTop * (1 - DESIGN.mossCoverage);
  const mossBlobCount = DESIGN.mossBlobCountMin + Math.floor(rng() * DESIGN.mossBlobCountRange);
  const mossChildren: Node[] = [
    // Base coat: a vertical wash that is opaque moss over the crown and
    // fades out by `mossLine`, so the blobs below have something to sit on
    // and the transition to bare stone is a gradient, not a hard edge.
    {
      kind: "path",
      d,
      paint: {
        type: "linear",
        from: { x: 0, y: mossTop },
        to: { x: 0, y: mossLine },
        stops: [
          { offset: 0, color: DESIGN.mossMidColor },
          // Stays fully opaque well past halfway before falling off. The
          // earlier `cc` here let stone show through the middle of the cap,
          // which combined with the blob edges to read as scattered patches
          // rather than as one continuous mat of moss.
          { offset: 0.72, color: DESIGN.mossDarkColor },
          { offset: 1, color: `${DESIGN.mossDarkColor}00` },
        ],
      },
    },
  ];
  // Blobs must MERGE into one mossy mass, never read as separate circles.
  // Radius is therefore sized against the spacing between them (each blob is
  // ~1.6 spacings wide, so neighbours overlap heavily) instead of against a
  // fixed fraction of the stone. An earlier pass used a fixed 0.16-0.26 of
  // width at 5-9 positions, which on a wide stone left visible gaps and read
  // as polka dots painted on grey.
  const spacing = width / mossBlobCount;
  for (let i = 0; i < mossBlobCount; i++) {
    const t = (i + 0.5) / mossBlobCount;
    // Sample the silhouette across the top so blobs follow the real dome,
    // not a straight line — `interior` is already the top-half vertices.
    const src = interior[Math.min(interior.length - 1, Math.floor(t * interior.length))];
    const r = spacing * (0.8 + rng() * 0.45);
    const lift = r * (0.5 + rng() * 0.35);
    const jx = (rng() - 0.5) * spacing * 0.5;
    mossChildren.push({
      kind: "circle",
      cx: src.x + jx,
      cy: src.y + lift,
      r,
      paint: { type: "solid", color: DESIGN.mossMidColor },
    });
    // A smaller, brighter cap on the sunward side of each blob — the
    // dappled top light that makes the sprite's moss read as clumped
    // growth rather than a flat green fill. Deliberately low-contrast and
    // well inside the blob: at full strength it re-created the very
    // "distinct dot" reading the merged radius above exists to avoid.
    mossChildren.push({
      kind: "circle",
      cx: src.x + jx - r * 0.22,
      cy: src.y + lift - r * 0.26,
      r: r * 0.45,
      paint: { type: "solid", color: DESIGN.mossLightColor, opacity: 0.32 },
    });
    // Grain: a handful of tiny specks per blob, half light and half dark.
    // `moss-ball.png` is visibly made of individual small leaves, and it is
    // that fine speckle — not the blob outline — that separates moss from a
    // flat green paint fill at the size these actually render.
    for (let g = 0; g < 5; g++) {
      const ga = rng() * Math.PI * 2;
      const gd = rng() * r * 0.8;
      mossChildren.push({
        kind: "circle",
        cx: src.x + jx + Math.cos(ga) * gd,
        cy: src.y + lift + Math.sin(ga) * gd * 0.7,
        r: r * (0.1 + rng() * 0.1),
        paint: {
          type: "solid",
          color: rng() > 0.5 ? DESIGN.mossLightColor : DESIGN.mossDarkColor,
          opacity: 0.45,
        },
      });
    }
  }

  // ---------------------------------------------------------------------
  // Pebbles at the foot
  // ---------------------------------------------------------------------
  // Drawn AFTER (over) the stone, straddling its base line — in the sprite
  // art these overlap the boulder's silhouette, which is what visually beds
  // it into the substrate instead of leaving it balanced on a hard edge.
  const pebbleCount = DESIGN.pebbleCountMin + Math.floor(rng() * DESIGN.pebbleCountRange);
  const pebbleNodes: Node[] = [];
  let pebbleReach = width / 2;
  for (let i = 0; i < pebbleCount; i++) {
    const r = (DESIGN.pebbleRadiusMin + rng() * DESIGN.pebbleRadiusRange) * width;
    // Biased to the two ends of the base — a pebble dead-centre in front
    // just reads as a bump on the rock.
    const side = i % 2 === 0 ? -1 : 1;
    const cx = side * (width * 0.3 + rng() * width * 0.22);
    const cy = -r * (0.35 + rng() * 0.3);
    pebbleReach = Math.max(pebbleReach, Math.abs(cx) + r);
    // `STONE_DARK`/`STONE_MID`, never `STONE_LIGHT` as the body colour, and
    // the highlight is a plain low-opacity overlay rather than a `screen`
    // blend: screening the light stone over itself blew these out into pale
    // white spheres that read as bubbles sitting in front of the rock.
    pebbleNodes.push({
      kind: "circle",
      cx,
      cy,
      r,
      paint: { type: "solid", color: rng() > 0.5 ? STONE_DARK : STONE_MID },
    });
    pebbleNodes.push({
      kind: "circle",
      cx: cx - r * 0.26,
      cy: cy - r * 0.3,
      r: r * 0.46,
      paint: { type: "solid", color: STONE_LIGHT, opacity: 0.35 },
    });
  }

  const nodes: Node[] = [
    // Beds the stone into the sand. Wood already had one of these and was
    // the only piece in the scene that looked seated rather than pasted on.
    contactShadow(0, width * 0.62, 0.32),
    { kind: "path", d, paint: { type: "solid", color: STONE_MID } },
    ...facetNodes,
    {
      kind: "path",
      d,
      blend: "multiply",
      paint: {
        type: "linear",
        from: { x: -width / 2, y: 0 },
        to: { x: width * 0.15, y: apex.y },
        stops: [
          { offset: 0, color: "rgba(0,0,0,0.4)" },
          { offset: 1, color: "rgba(0,0,0,0)" },
        ],
      },
    },
    {
      kind: "path",
      d,
      blend: "screen",
      paint: {
        type: "linear",
        from: { x: apex.x - width * 0.1, y: apex.y },
        to: { x: apex.x + width * 0.25, y: apex.y * 0.3 },
        stops: [
          { offset: 0, color: `${STONE_LIGHT}55` },
          { offset: 1, color: "rgba(255,255,255,0)" },
        ],
      },
    },
    // Surface material, UNDER the moss: blotching first (large-scale tonal
    // variation), then grit, then cracks. Order matters — grain scattered
    // over an already-mottled face reads as the surface; the same grain over
    // a flat gradient reads as noise sprinkled on plastic. See `texture.ts`.
    mottlePatches(d, { x: -width / 2, y: apex.y, width, height: -apex.y }, rng, STONE_DARK, 5, 0.2),
    grainSpeckles(
      d,
      { x: -width / 2, y: apex.y, width, height: -apex.y },
      rng,
      STONE_DARK,
      STONE_LIGHT,
      30,
      0.5,
      1.2,
      0.3,
    ),
    crackLines(d, { x: -width / 2, y: apex.y, width, height: -apex.y }, rng, STONE_DARK, 3, 0.32),
    // Moss goes over the stone's own shading so it keeps its own local
    // value range, but UNDER the outline below, which still has to read as
    // the whole piece's silhouette.
    { kind: "group", clip: d, children: mossChildren },
    {
      kind: "path",
      d,
      paint: { type: "solid", color: STONE_DARK, opacity: 0.5 },
      stroke: { width: 1.4 },
    },
    ...pebbleNodes,
  ];

  return {
    nodes,
    // Widened to cover the pebbles — they sit past the stone's own half-width
    // and would otherwise be cropped by the bake bounds.
    bbox: { x: -pebbleReach, y: apex.y, width: pebbleReach * 2, height: -apex.y },
    anchors: [],
    swayHeight: 0,
  };
};
