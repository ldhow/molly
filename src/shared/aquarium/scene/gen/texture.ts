// The surface-detail toolkit — the third and last layer of the generated
// look, after `ribbon.ts` (silhouette) and `depth.ts` (volume).
//
// Those two together get a piece as far as "a correctly shaped, correctly lit
// solid", and that is where the generated scene plateaued against the painted
// sprite art: shape and value were close, MATERIAL was missing entirely.
// Every piece in `assets/images/scene/*.png` carries fine surface incident —
// grit across a stone face, lengthwise fibre in bark, individual leaflets in
// a moss mat. Read at tank size you do not consciously see any of it; what
// you see is "rock" instead of "grey shape". A perfectly smooth gradient is
// the single most synthetic-looking thing a generator can emit, because no
// real surface is smooth.
//
// Everything here is CLIPPED to a caller-supplied silhouette, so a generator
// can scatter freely across a bounding box without any of it escaping the
// shape it belongs to.
//
// Dependency-free (no React/RN/Skia), like the rest of `scene/gen/`.

import type { Box, Node, XY } from "@/shared/aquarium/core/ir";

/**
 * Fine granular speckle across a shape — stone grit, moss leaflets, sand.
 *
 * Two-tone on purpose: speckles that are only darker read as dirt on the
 * surface, and only-lighter reads as snow. Real grain is both, because it is
 * micro-relief catching and hiding the same light.
 *
 * `density` is speckles per 1000 square local units, so a big rock and a
 * small pebble get visually comparable grain without the caller doing the
 * area arithmetic.
 */
export function grainSpeckles(
  clipD: string,
  box: Box,
  rng: () => number,
  darkColor: string,
  lightColor: string,
  density = 26,
  radiusMin = 0.5,
  radiusRange = 1.3,
  opacity = 0.3,
): Node {
  const count = Math.min(420, Math.round((box.width * box.height * density) / 1000));
  const children: Node[] = [];
  for (let i = 0; i < count; i++) {
    children.push({
      kind: "circle",
      cx: box.x + rng() * box.width,
      cy: box.y + rng() * box.height,
      r: radiusMin + rng() * radiusRange,
      paint: {
        type: "solid",
        color: rng() > 0.5 ? lightColor : darkColor,
        opacity: opacity * (0.5 + rng() * 0.5),
      },
    });
  }
  return { kind: "group", clip: clipD, children };
}

/**
 * Soft irregular tonal patches — the large-scale blotching under the grain.
 * Weathered stone and old wood are never one flat tone across a face; without
 * this the speckle above sits on an obviously uniform ground and reads as
 * noise sprinkled over plastic rather than as the surface itself.
 *
 * Blurred, and low opacity, because these must never resolve as shapes.
 */
export function mottlePatches(
  clipD: string,
  box: Box,
  rng: () => number,
  color: string,
  count = 5,
  opacity = 0.22,
): Node {
  const children: Node[] = [];
  const span = Math.min(box.width, box.height);
  for (let i = 0; i < count; i++) {
    const r = span * (0.18 + rng() * 0.26);
    const cx = box.x + rng() * box.width;
    const cy = box.y + rng() * box.height;
    children.push({
      kind: "circle",
      cx,
      cy,
      r,
      blend: "multiply",
      paint: {
        type: "radial",
        center: { x: cx, y: cy },
        radius: r,
        // Elliptical: a circular patch reads as a deliberate spot, a
        // squashed one as an accident of the surface.
        scale: { x: 1, y: 0.55 + rng() * 0.4 },
        stops: [
          { offset: 0, color: withAlpha(color, opacity) },
          { offset: 1, color: withAlpha(color, 0) },
        ],
      },
    });
  }
  return { kind: "group", clip: clipD, children };
}

/**
 * Hairline cracks radiating across a stone face.
 *
 * Deliberately drawn in the piece's own DARK tone at low opacity rather than
 * black: a black crack on a mid-grey stone reads as a scratch on the screen,
 * which is a different (and worse) artifact than the one this fixes.
 */
export function crackLines(
  clipD: string,
  box: Box,
  rng: () => number,
  color: string,
  count = 3,
  opacity = 0.3,
): Node {
  const children: Node[] = [];
  for (let i = 0; i < count; i++) {
    let x = box.x + rng() * box.width;
    let y = box.y + box.height * (0.15 + rng() * 0.5);
    let d = `M ${x.toFixed(1)} ${y.toFixed(1)}`;
    // A short random walk, biased downward — cracks run with gravity and
    // with the bedding planes of the rock, not in every direction equally.
    const steps = 3 + Math.floor(rng() * 3);
    for (let s = 0; s < steps; s++) {
      x += (rng() - 0.5) * box.width * 0.3;
      y += rng() * box.height * 0.22;
      d += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    children.push({
      kind: "path",
      d,
      paint: { type: "solid", color, opacity: opacity * (0.6 + rng() * 0.4) },
      stroke: { width: 0.6 + rng() * 0.7 },
    });
  }
  return { kind: "group", clip: clipD, children };
}

/**
 * Fine side-veins fanning off a spine toward the tip — the surface detail
 * that separates "leaf" from "green ribbon". A generator with only a midrib
 * line (`spinePath`) draws the one vein a real blade is LEAST likely to be
 * mistaken for the whole venation of; every leaf in `assets/images/scene/`
 * has lateral veins visibly branching off it.
 *
 * `count` veins are placed evenly along the blade (skipping the very base
 * and tip, where a real leaf has none yet). Each is a straight stroke from
 * the spine outward at `angleDeg` off the local tangent, SHEARED toward the
 * tip on both sides — real lateral veins fan forward, they don't run square
 * across the blade — sized to `widthAt(t)` so they scale with the blade's
 * own taper and never depend on a caller-supplied clip to stay inside it.
 */
export function lateralVeins(
  spine: readonly XY[],
  widthAt: (t: number) => number,
  color: string,
  opacity = 0.3,
  count = 9,
  angleDeg = 28,
): Node {
  const children: Node[] = [];
  const angle = (angleDeg * Math.PI) / 180;
  for (let i = 1; i <= count; i++) {
    const t = i / (count + 1);
    const idx = Math.min(spine.length - 1, Math.max(0, Math.round(t * (spine.length - 1))));
    const p = spine[idx];
    const prev = spine[Math.max(0, idx - 1)];
    const next = spine[Math.min(spine.length - 1, idx + 1)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    const tx = dx / len;
    const ty = dy / len;
    const nx = -ty;
    const ny = tx;
    // 0.78, not 1: the ribbon's own margin can carry a low-frequency ripple
    // (`sword.ts`'s `widthAt`), so a vein sized to the exact nominal width
    // would occasionally poke past a dented edge. Staying inside it is
    // cheaper than clipping every vein to the blade's own path.
    const half = (widthAt(t) / 2) * 0.78;
    for (const side of [1, -1] as const) {
      const dirX = nx * side * Math.cos(angle) + tx * Math.sin(angle);
      const dirY = ny * side * Math.cos(angle) + ty * Math.sin(angle);
      children.push({
        kind: "path",
        d: `M ${p.x.toFixed(2)} ${p.y.toFixed(2)} L ${(p.x + dirX * half).toFixed(2)} ${(p.y + dirY * half).toFixed(2)}`,
        paint: { type: "solid", color, opacity: opacity * (0.55 + 0.45 * Math.sin(t * Math.PI)) },
        stroke: { width: Math.max(0.5, half * 0.09) },
      });
    }
  }
  return { kind: "group", children };
}

/** `#rrggbb` + alpha as an `rgba()` string — the IR takes CSS colour strings, and the stops above need per-stop alpha. */
function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
}
