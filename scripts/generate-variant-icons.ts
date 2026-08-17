/**
 * One-off generator for the dev/preview app-icon variants.
 *
 * Run with `npm run generate:variant-icons` whenever assets/images/icon.png
 * changes. Output is committed as static assets — this script has no role
 * at build time.
 */
import path from "node:path";
import sharp from "sharp";

const ASSETS_DIR = path.join(__dirname, "..", "assets", "images");
const ICON_SIZE = 1024;
const ADAPTIVE_BG_SIZE = 432; // matches android-icon-background.png

type RibbonVariant = {
  name: "dev" | "preview";
  label: string;
  color: string;
  adaptiveBackgroundColor: string;
};

const VARIANTS: RibbonVariant[] = [
  { name: "dev", label: "DEV", color: "#F59E0B", adaptiveBackgroundColor: "#FDECC8" },
  { name: "preview", label: "PREVIEW", color: "#8B5CF6", adaptiveBackgroundColor: "#EDE4FB" },
];

function ribbonSvg(label: string, color: string): Buffer {
  // A straight banner across the top of the icon. Simpler and more robust
  // than a rotated corner ribbon: text is never rotated, so there's no
  // diagonal-geometry math to get wrong for labels of different lengths.
  const bandHeight = 170;
  const svg = `
    <svg width="${ICON_SIZE}" height="${ICON_SIZE}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${ICON_SIZE}" height="${bandHeight}" fill="${color}" />
      <text
        x="${ICON_SIZE / 2}"
        y="${bandHeight / 2 + 20}"
        font-family="Arial, sans-serif"
        font-size="72"
        font-weight="bold"
        fill="#FFFFFF"
        text-anchor="middle"
        letter-spacing="6"
      >${label}</text>
    </svg>
  `;
  return Buffer.from(svg);
}

function adaptiveBackgroundSvg(color: string): Buffer {
  const svg = `<svg width="${ADAPTIVE_BG_SIZE}" height="${ADAPTIVE_BG_SIZE}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${ADAPTIVE_BG_SIZE}" height="${ADAPTIVE_BG_SIZE}" fill="${color}" />
  </svg>`;
  return Buffer.from(svg);
}

async function main() {
  const baseIcon = path.join(ASSETS_DIR, "icon.png");

  for (const variant of VARIANTS) {
    const iconOut = path.join(ASSETS_DIR, `icon-${variant.name}.png`);
    await sharp(baseIcon)
      .composite([{ input: ribbonSvg(variant.label, variant.color) }])
      .png()
      .toFile(iconOut);
    console.log(`wrote ${path.relative(process.cwd(), iconOut)}`);

    const bgOut = path.join(ASSETS_DIR, `android-icon-background-${variant.name}.png`);
    await sharp(adaptiveBackgroundSvg(variant.adaptiveBackgroundColor)).png().toFile(bgOut);
    console.log(`wrote ${path.relative(process.cwd(), bgOut)}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
