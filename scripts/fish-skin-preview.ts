// Generates src/docs/fish-skin-preview.html — every variety's 3D skin texture
// side by side with the 2D SVG fish it was derived from. This is the art
// A/B loop for the 3D renderer: no device, no GL, just open the file.
// Run: yarn fish:skin-preview

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { COLOR_DEFS } from "../src/shared/fish/catalog";
import { buildSkinMap } from "../src/shared/fish/skin-map";
import type { BodyId, FishTraits } from "../src/shared/fish/types";
import { encodePng } from "./lib/png";
import { fishSvg } from "./lib/fish-svg";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

function dataUri(width: number, height: number, rgba: Uint8ClampedArray): string {
  return `data:image/png;base64,${encodePng(width, height, rgba).toString("base64")}`;
}

function traitsFor(color: string, body: BodyId, patternSeed: number): FishTraits {
  return {
    color: color as FishTraits["color"],
    body,
    tail: "round",
    dorsal: "standard",
    patternSeed,
  };
}

const rows = COLOR_DEFS.map((def) => {
  const traits = traitsFor(def.id, "standard", 0);
  const map = buildSkinMap(traits, def);
  const alt = buildSkinMap(traitsFor(def.id, "standard", 3), def);
  const balloon = buildSkinMap(traitsFor(def.id, "balloon", 0), def);

  // Count distinct quantised colours inside the opaque region — the number
  // that proves a variety isn't rendering as one flat blob.
  const seen = new Set<number>();
  for (let i = 0; i < map.data.length; i += 4) {
    if (map.data[i + 3] < 200) continue;
    seen.add(((map.data[i] >> 3) << 10) | ((map.data[i + 1] >> 3) << 5) | (map.data[i + 2] >> 3));
  }

  return `<tr>
    <td class="meta">
      <div class="name">${def.name}</div>
      <div class="hint">${def.pattern.type}${def.shimmer ? ` + ${def.shimmer}` : ""}</div>
      <div class="hint">${def.rarity.tier}</div>
      <div class="tones">${seen.size} tones</div>
    </td>
    <td>${fishSvg(traits, def, { stage: "adult" })}</td>
    <td><img src="${dataUri(map.width, map.height, map.data)}" width="${map.width}"></td>
    <td><img src="${dataUri(alt.width, alt.height, alt.data)}" width="${alt.width}"></td>
    <td><img src="${dataUri(balloon.width, balloon.height, balloon.data)}" width="${balloon.width}"></td>
  </tr>`;
}).join("\n");

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Molly 3D skin maps</title>
<style>
  body { margin:0; padding:24px; font-family:-apple-system,"Segoe UI",sans-serif;
         background:linear-gradient(180deg,#0b3a5c,#063049 45%,#02131f); color:#eaf6ff; }
  h1 { font-size:20px; } p { color:#8fb3cc; font-size:12px; max-width:820px; }
  table { border-collapse:collapse; margin-top:16px; }
  td { padding:8px 10px; vertical-align:middle; border-top:1px solid rgba(255,255,255,.08); }
  thead td { color:#8fb3cc; font-size:12px; border:0; }
  .meta { min-width:150px; }
  .name { font-weight:700; font-size:14px; }
  .hint { color:#8fb3cc; font-size:11px; }
  .tones { color:#54788f; font-size:11px; margin-top:3px; }
  img { image-rendering:pixelated; background:
        repeating-conic-gradient(#1b2b38 0 25%, #16232e 0 50%) 0 0/12px 12px; border-radius:3px; }
</style></head><body>
<h1>🐟 3D skin maps — pigment only</h1>
<p>Left: the 2D fish. Right: the albedo texture the 3D renderer wraps onto the body, rasterized from
the <em>same</em> IR primitives by <code>src/shared/fish/raster.ts</code>. Volume shading, gloss,
outline and rim light are deliberately excluded — in 3D those come from real lights.
"tones" counts distinct quantised colours in the opaque region; a variety showing very few is
rendering as a flat blob. Regenerate with <code>yarn fish:skin-preview</code>.</p>
<table>
<thead><tr><td>Variety</td><td>2D reference</td><td>Skin (seed 0)</td><td>Skin (seed 3)</td><td>Balloon body</td></tr></thead>
<tbody>
${rows}
</tbody></table>
</body></html>`;

const outPath = join(root, "src/docs/fish-skin-preview.html");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, html);
console.log(`Wrote ${outPath}`);
