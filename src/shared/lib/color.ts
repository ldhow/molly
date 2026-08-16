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

// ---------------------------------------------------------------------------
// HSL + perceptual contrast — added for the procedural breed generator
// (`fish/generated-breed.ts`), which reasons about colour harmony and
// readability rather than hand-picking hex. Additive only: nothing above this
// line changed, because the shipped palettes' baked pixels depend on it.
// ---------------------------------------------------------------------------

/** Hue in degrees (0..360), saturation and lightness as 0..1. */
export interface Hsl {
  h: number;
  s: number;
  l: number;
}

export const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Wraps any hue, positive or negative, into [0, 360). */
export const wrapHue = (h: number) => ((h % 360) + 360) % 360;

/**
 * HSL -> `#rrggbb`, always lowercase and always exactly 6 digits — `parseHex`
 * accepts only that form and silently no-ops otherwise, so every string this
 * generator hands downstream has to round-trip through it cleanly.
 */
export function hslToHex(h: number, s: number, l: number): string {
  const hue = wrapHue(h);
  const sat = clamp01(s);
  const lit = clamp01(l);
  const c = (1 - Math.abs(2 * lit - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lit - c / 2;
  const seg = Math.floor(hue / 60) % 6;
  const rgb =
    seg === 0
      ? [c, x, 0]
      : seg === 1
        ? [x, c, 0]
        : seg === 2
          ? [0, c, x]
          : seg === 3
            ? [0, x, c]
            : seg === 4
              ? [x, 0, c]
              : [c, 0, x];
  const hx = rgb
    .map((v) =>
      Math.round((v + m) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");
  return `#${hx}`;
}

/** `#rrggbb` -> HSL. Falls back to black on a malformed input, same as `mix`. */
export function hexToHsl(hex: string): Hsl {
  const rgb = parseHex(hex);
  if (!rgb) return { h: 0, s: 0, l: 0 };
  const [r, g, b] = rgb.map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h =
    max === r
      ? 60 * (((g - b) / d) % 6)
      : max === g
        ? 60 * ((b - r) / d + 2)
        : 60 * ((r - g) / d + 4);
  return { h: wrapHue(h), s: clamp01(s), l };
}

/** Same hue and saturation, new lightness. */
export function withL(hex: string, l: number): string {
  const c = hexToHsl(hex);
  return hslToHex(c.h, c.s, l);
}

/** Same hue and lightness, new saturation. */
export function withS(hex: string, s: number): string {
  const c = hexToHsl(hex);
  return hslToHex(c.h, s, c.l);
}

/** Rotates the hue by `deg`, keeping saturation and lightness. */
export function rotateHue(hex: string, deg: number): string {
  const c = hexToHsl(hex);
  return hslToHex(c.h + deg, c.s, c.l);
}

/** WCAG relative luminance, sRGB-linearized. */
export function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex) ?? [0, 0, 0];
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * WCAG contrast ratio, 1..21. Used as a readability floor rather than an
 * accessibility grade: "does this flank separate from the water", "does this
 * pattern separate from the flank".
 */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
