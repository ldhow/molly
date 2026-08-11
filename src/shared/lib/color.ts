// Hex colour maths shared by the fish renderers.
//
// Deliberately dependency-free — no React/RN/Skia/three. `render-spec.ts`
// imports this and must keep running under plain Node for the SVG preview
// generator, and the 3D side needs the same arithmetic to shade fins and
// build textures. One implementation, so 2D and 3D can't drift.

/** `#rrggbb` → [r,g,b] in 0..255, or null if it isn't that exact form. */
export function parseHex(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Blend `hex` toward an RGB target by `t` (0 = unchanged, 1 = target). */
export function mix(hex: string, target: readonly [number, number, number], t: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const hx = rgb
    .map((v, i) =>
      Math.round(v + (target[i] - v) * t)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");
  return `#${hx}`;
}

export const darken = (hex: string, t: number) => mix(hex, [0, 0, 0], t);
export const lighten = (hex: string, t: number) => mix(hex, [255, 255, 255], t);

export function rgba(hex: string, alpha: number): string {
  const rgb = parseHex(hex) ?? [255, 255, 255];
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
}
