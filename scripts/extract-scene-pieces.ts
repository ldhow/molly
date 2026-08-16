// Extracts individual sprite pieces from a hand-supplied sheet in
// `assets/images/scene/` — by default `scene.png`, which has two sections
// stacked in one image:
//   - a complete pre-composed scene at the top (y < STRIP_BOTTOM) — a STYLE
//     REFERENCE only, not used directly; the actual sprite-mode art is
//     assembled from individually-placed pieces (see
//     `scene/themes/nature-scape-sprites.ts`), not one fixed image.
//   - individual pieces below, on a near-white "checker" background that
//     LOOKS transparent but isn't: the file has no alpha channel at all
//     (RGB, not RGBA) — the checkering is baked-in near-white pixels, not
//     real transparency.
//
// Some hand-supplied sheets have no real alpha channel at all (the
// "checker"/"glow" backdrop is baked-in near-white or near-black pixels,
// not transparency) — this auto-detects that case (a negligible fraction of
// truly alpha=0 pixels in the piece region) and reconstructs alpha via a
// whiteness threshold (min(r,g,b) above the threshold -> transparent, with
// a soft feather band so edges anti-alias instead of going jagged) before
// proceeding. Sheets that already carry real alpha skip this untouched.
// Either way, it then runs connected-component detection to crop each piece
// to its own tight PNG, plus a labeled contact sheet for identifying each
// crop by eye before naming it and adding it to `sprite-manifest.ts`.
//
// Run: `npx tsx scripts/extract-scene-pieces.ts [filename] [stripBottom]`.
//   filename     — sheet to read from `assets/images/scene/` (default `scene.png`).
//   stripBottom  — y below which pieces start (default 470); pass `0` for a
//                  sheet with no reference-scene strip at the top (e.g. a
//                  pure piece sheet like `pieces.png`).
// Writes numbered crops to a scratch dir (`.scratch/scene-piece-crops/`,
// NOT assets/) — promoting the ones worth keeping into
// `assets/images/scene/` with real names is a manual follow-up step.

import fs from "node:fs";
import path from "node:path";

import { loadSkiaNode } from "./lib/skia-node";
import { AlphaType, ColorType } from "@shopify/react-native-skia/src/skia/types";

const SRC_FILE = process.argv[2] ?? "scene.png";
const SRC = path.join(__dirname, "..", "assets", "images", "scene", SRC_FILE);
const OUT_DIR = path.join(
  __dirname,
  "..",
  ".scratch",
  "scene-piece-crops",
  SRC_FILE.replace(/\.png$/i, ""),
);
const STRIP_BOTTOM = process.argv[3] ? Number(process.argv[3]) : 470; // background reference strip occupies roughly y=0..460; pass 0 for a sheet with no such strip
const WHITE_THRESHOLD = 240;
const WHITE_FEATHER = 14;
const ALPHA_THRESHOLD = 30;
const MIN_AREA = 250;
const PAD = 3;

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  area: number;
}

/** True if the region already has a meaningful fraction of real alpha=0 pixels — i.e. it needs no reconstruction. */
function hasRealAlpha(px: Uint8Array, w: number, h: number, yStart: number): boolean {
  let transparent = 0;
  let sampled = 0;
  for (let y = yStart; y < h; y += 4) {
    for (let x = 0; x < w; x += 4) {
      sampled++;
      if (px[(y * w + x) * 4 + 3] === 0) transparent++;
    }
  }
  return transparent / sampled > 0.05;
}

function reconstructAlpha(px: Uint8Array, w: number, h: number, yStart: number): void {
  for (let y = yStart; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const minC = Math.min(px[i], px[i + 1], px[i + 2]);
      if (minC >= WHITE_THRESHOLD) {
        px[i + 3] = 0;
      } else if (minC >= WHITE_THRESHOLD - WHITE_FEATHER) {
        const t = (WHITE_THRESHOLD - minC) / WHITE_FEATHER;
        px[i + 3] = Math.round(255 * t);
      }
    }
  }
}

function findComponents(px: Uint8Array, w: number, h: number, yStart: number): Box[] {
  const visited = new Uint8Array(w * h);
  const isFg = (x: number, y: number) => px[(y * w + x) * 4 + 3] > ALPHA_THRESHOLD;
  const boxes: Box[] = [];
  const stack: number[] = [];

  for (let y = yStart; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (visited[idx] || !isFg(x, y)) continue;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let area = 0;
      stack.push(idx);
      visited[idx] = 1;
      while (stack.length > 0) {
        const cur = stack.pop()!;
        const cx = cur % w;
        const cy = (cur - cx) / w;
        area++;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        const neighbors = [
          [cx - 1, cy],
          [cx + 1, cy],
          [cx, cy - 1],
          [cx, cy + 1],
        ] as const;
        for (const [nx, ny] of neighbors) {
          if (nx < 0 || nx >= w || ny < yStart || ny >= h) continue;
          const nIdx = ny * w + nx;
          if (visited[nIdx] || !isFg(nx, ny)) continue;
          visited[nIdx] = 1;
          stack.push(nIdx);
        }
      }
      if (area >= MIN_AREA) boxes.push({ minX, minY, maxX, maxY, area });
    }
  }
  boxes.sort((a, b) => {
    const rowA = Math.round(a.minY / 60);
    const rowB = Math.round(b.minY / 60);
    return rowA !== rowB ? rowA - rowB : a.minX - b.minX;
  });
  return boxes;
}

async function main() {
  const Skia = await loadSkiaNode();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const bytes = fs.readFileSync(SRC);
  const img = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(bytes));
  if (!img) throw new Error(`failed to decode ${SRC_FILE}`);
  const w = img.width();
  const h = img.height();
  const px = img.readPixels() as Uint8Array;

  // Crop the background strip as-is too, for reference (fully opaque, no
  // alpha work needed) — only when the sheet actually has one.
  if (STRIP_BOTTOM > 0) {
    const surf = Skia.Surface.Make(w, STRIP_BOTTOM)!;
    surf
      .getCanvas()
      .drawImageRect(
        img,
        Skia.XYWHRect(0, 0, w, STRIP_BOTTOM),
        Skia.XYWHRect(0, 0, w, STRIP_BOTTOM),
        Skia.Paint(),
      );
    fs.writeFileSync(
      path.join(OUT_DIR, "_background-strip.png"),
      Buffer.from(surf.makeImageSnapshot().encodeToBytes()),
    );
  }

  if (hasRealAlpha(px, w, h, STRIP_BOTTOM)) {
    console.log("Source already has real alpha — skipping reconstruction.\n");
  } else {
    reconstructAlpha(px, w, h, STRIP_BOTTOM);
  }
  const boxes = findComponents(px, w, h, STRIP_BOTTOM);
  console.log(`Found ${boxes.length} piece components below y=${STRIP_BOTTOM}\n`);

  // Rebuild an SkImage from the alpha-corrected buffer to crop from.
  const info = {
    width: w,
    height: h,
    alphaType: AlphaType.Unpremul,
    colorType: ColorType.RGBA_8888,
  };
  const correctedImg = Skia.Image.MakeImage(info, Skia.Data.fromBytes(px), w * 4);
  if (!correctedImg) throw new Error("failed to rebuild image from corrected pixels");

  const crops: { index: number; box: Box; w: number; h: number }[] = [];
  boxes.forEach((box, i) => {
    const x = Math.max(0, box.minX - PAD);
    const y = Math.max(STRIP_BOTTOM, box.minY - PAD);
    const cw = Math.min(w, box.maxX + PAD + 1) - x;
    const ch = Math.min(h, box.maxY + PAD + 1) - y;

    const surf = Skia.Surface.Make(cw, ch)!;
    const canvas = surf.getCanvas();
    canvas.clear(Skia.Color("#00000000"));
    canvas.drawImageRect(
      correctedImg,
      Skia.XYWHRect(x, y, cw, ch),
      Skia.XYWHRect(0, 0, cw, ch),
      Skia.Paint(),
    );
    const file = path.join(OUT_DIR, `piece-${String(i).padStart(2, "0")}.png`);
    fs.writeFileSync(file, Buffer.from(surf.makeImageSnapshot().encodeToBytes()));
    console.log(
      `piece-${String(i).padStart(2, "0")}.png  bbox=(${box.minX},${box.minY})-(${box.maxX},${box.maxY})  ${cw}x${ch}  area=${box.area}`,
    );
    crops.push({ index: i, box, w: cw, h: ch });
  });

  // Contact sheet.
  const CELL = 150;
  const cols = 8;
  const rows = Math.ceil(crops.length / cols);
  const sheet = Skia.Surface.Make(cols * CELL, rows * CELL)!;
  const sheetCanvas = sheet.getCanvas();
  sheetCanvas.clear(Skia.Color("#20301f"));
  const font = Skia.Font(undefined, 14);
  const textPaint = Skia.Paint();
  textPaint.setColor(Skia.Color("#ffffff"));
  const gridPaint = Skia.Paint();
  gridPaint.setColor(Skia.Color("#ffffff22"));
  gridPaint.setStyle(1);

  crops.forEach(({ index, box, w: cw, h: ch }, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cellX = col * CELL;
    const cellY = row * CELL;
    sheetCanvas.drawRect(Skia.XYWHRect(cellX, cellY, CELL, CELL), gridPaint);
    const maxDim = CELL - 30;
    const scale = Math.min(1, maxDim / Math.max(cw, ch));
    const dw = cw * scale;
    const dh = ch * scale;
    const destX = cellX + (CELL - dw) / 2;
    const destY = cellY + 22 + (CELL - 22 - dh) / 2;
    sheetCanvas.drawImageRect(
      correctedImg,
      Skia.XYWHRect(box.minX - PAD, box.minY - PAD, cw, ch),
      Skia.XYWHRect(destX, destY, dw, dh),
      Skia.Paint(),
    );
    sheetCanvas.drawText(`${index}`, cellX + 4, cellY + 16, textPaint, font);
  });
  const sheetPath = path.join(OUT_DIR, "_contact-sheet.png");
  fs.writeFileSync(sheetPath, Buffer.from(sheet.makeImageSnapshot().encodeToBytes()));
  console.log(`\nContact sheet: ${sheetPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
