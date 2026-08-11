// Generates src/docs/fish-tank-preview.html — a browser-only, live-animated
// tank you can open with no dev server, no device, and no `expo start`. Run:
// yarn fish:tank-preview
//
// Two things are bundled straight from the source of truth, so this can't
// drift from the app:
//   - Fish art: scripts/lib/fish-svg.ts -> render-spec.ts (same as fish-preview.ts)
//   - Swim physics: src/shared/lib/swim-model.ts, bundled to browser JS via
//     esbuild (it has zero RN/Skia imports by design, so it's bundle-safe).
//
// What's NOT reproduced: the Vertices-mesh body undulation from
// undulating-body.tsx (that warp only exists as a Skia draw-time effect over
// a baked texture — there's nothing to bundle). Tail beat, pectoral flutter,
// the swim path, and the pseudo-3D turn (CSS perspective+rotateY, a genuine
// analog of the app's Skia transform) are all faithful. This is a "does the
// motion feel right" tool, not a pixel-accurate regression tool — use a real
// device/AVD (see CLAUDE.md) for that.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";

import { COLOR_DEFS, getColorDef, patternSeedOf, rollTraits } from "../src/shared/fish/catalog";
import { seedFromString } from "../src/shared/lib/seed";
import { fishSvgLayers } from "./lib/fish-svg";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

// ---------------------------------------------------------------------------
// Bundle the real swim model + the sand-height helper for the browser.
// `swim-model.ts` imports SWIM_SPEED via the "@/*" tsconfig alias, which
// esbuild doesn't know about on its own — pointed at the real file so the
// bundle uses the same constant the app does, not a copy.
// ---------------------------------------------------------------------------

const bundle = esbuild.buildSync({
  stdin: {
    contents: `
      export { initSwimState, stepSwim, waveDy } from "../src/shared/lib/swim-model";
      export { sandHeightFor, SWIM_SPEED } from "../src/shared/constants/tank";
    `,
    resolveDir: here,
    loader: "ts",
  },
  bundle: true,
  write: false,
  format: "iife",
  globalName: "SwimModel",
  platform: "browser",
  target: "es2020",
  alias: {
    "@/shared/constants/tank": join(root, "src/shared/constants/tank.ts"),
  },
});
const swimModelJs = bundle.outputFiles[0].text;

// ---------------------------------------------------------------------------
// Generate a varied set of fish — every color, random body/tail/dorsal roll.
// ---------------------------------------------------------------------------

const FISH_COUNT = 16;
const PPU = 1.4; // pixels per local render-spec unit

interface PreviewFish {
  id: string;
  seed: number;
  scale: number;
  layers: ReturnType<typeof fishSvgLayers>;
}

const fish: PreviewFish[] = Array.from({ length: FISH_COUNT }, (_, i) => {
  const color = COLOR_DEFS[i % COLOR_DEFS.length].id;
  const id = `preview-${i}-${color}`;
  const traits = { ...rollTraits(color), patternSeed: patternSeedOf(id) };
  return {
    id,
    seed: seedFromString(id),
    scale: PPU * (0.85 + ((seedFromString(id) * 53) % 1) * 0.3),
    layers: fishSvgLayers(traits, getColorDef(color)),
  };
});

const fishMarkup = fish
  .map((f, i) => {
    const { bounds } = f.layers;
    const w = bounds.width * PPU;
    const h = bounds.height * PPU;
    const originX = -bounds.x * PPU;
    const originY = -bounds.y * PPU;
    return `<div class="fish" id="fish-${i}" style="width:${w}px;height:${h}px;transform-origin:${originX}px ${originY}px;">
  <svg viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}" width="${w}" height="${h}">
    <defs>${f.layers.defsHtml}</defs>
    <g class="body">${f.layers.bodyHtml}</g>
    <g class="tail" id="tail-${i}">${f.layers.tailHtml}</g>
    <g class="front" id="front-${i}">${f.layers.frontHtml}</g>
  </svg>
</div>`;
  })
  .join("\n");

const fishInitJs = fish
  .map(
    (f, i) =>
      `{seed:${f.seed}, scale:${f.scale.toFixed(4)}, phase:${(f.seed * Math.PI * 2).toFixed(4)}, ` +
      `tailPivot:{x:${f.layers.tailPivot.x.toFixed(2)},y:${f.layers.tailPivot.y.toFixed(2)}}, ` +
      `pectoralPivot:{x:${f.layers.pectoralPivot.x.toFixed(2)},y:${f.layers.pectoralPivot.y.toFixed(2)}}, ` +
      `bounds:{x:${f.layers.bounds.x.toFixed(2)},y:${f.layers.bounds.y.toFixed(2)},width:${f.layers.bounds.width.toFixed(2)},height:${f.layers.bounds.height.toFixed(2)}}}`,
  )
  .join(",\n  ");

// ---------------------------------------------------------------------------
// The driver: ports the exact per-frame math from fish-sprite.tsx /
// use-fish-swim.ts to plain JS + CSS, driven by the bundled physics above.
// ---------------------------------------------------------------------------

const driverJs = `
const box = { minX: 0, maxX: 100, minY: 0, maxY: 100 };
function recomputeBox() {
  const w = tank.clientWidth, h = tank.clientHeight;
  const insetX = Math.min(48, w * 0.1);
  const insetTop = Math.min(40, h * 0.08);
  const insetBottom = Math.min(30, h * 0.06);
  box.minX = insetX;
  box.maxX = Math.max(insetX + 1, w - insetX);
  box.minY = insetTop;
  box.maxY = Math.max(insetTop + 1, h - SwimModel.sandHeightFor(h) - insetBottom);
}
window.addEventListener("resize", recomputeBox);
recomputeBox();

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

const fishes = FISH_DATA.map((data, i) => {
  const state = SwimModel.initSwimState(box, data.seed);
  return {
    ...data,
    state,
    el: document.getElementById("fish-" + i),
    tailEl: document.getElementById("tail-" + i),
    frontEl: document.getElementById("front-" + i),
    yawFrom: state.facingRight ? 0 : 180,
    yawTo: state.facingRight ? 0 : 180,
    yawT0: 0,
  };
});

function currentYaw(f, now) {
  const t = Math.min(1, (now - f.yawT0) / 420);
  return f.yawFrom + (f.yawTo - f.yawFrom) * easeInOutCubic(t);
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.064, (now - last) / 1000);
  last = now;
  for (const f of fishes) {
    const wasFacingRight = f.state.facingRight;
    SwimModel.stepSwim(f.state, box, dt, 1, f.phase, Math.random);

    if (f.state.facingRight !== wasFacingRight) {
      const cur = currentYaw(f, now);
      f.yawFrom = cur;
      f.yawTo = f.state.facingRight ? 0 : 180;
      f.yawT0 = now;
    }
    const yaw = currentYaw(f, now);

    const bob = Math.sin(now / 900 + f.phase) * 3;
    const stroke = 1 - 0.02 * Math.abs(Math.sin(f.state.beatPhase * 0.5));
    const dir = f.state.facingRight ? 1 : -1;
    const bank = Math.max(-0.15, Math.min(0.15, -dir * f.state.turnRate * 0.12));

    f.el.style.transform =
      "translate(" + f.state.x + "px, " + (f.state.y + bob) + "px) " +
      "rotate(" + (f.state.tilt + bank) + "rad) " +
      "perspective(550px) rotateY(" + yaw + "deg) " +
      "scale(" + (f.scale * stroke) + ", " + f.scale + ")";

    const uP = (f.tailPivot.x - f.bounds.x) / f.bounds.width;
    const dy = SwimModel.waveDy(uP, f.state.beatPhase, f.state.speedNorm, f.phase);
    const tailAmp = 0.16 + 0.14 * f.state.speedNorm;
    const rot = tailAmp * Math.sin(f.state.beatPhase - 4.8 * uP + f.phase - 0.4);
    f.tailEl.setAttribute(
      "transform",
      "translate(0 " + dy + ") rotate(" + (rot * 180) / Math.PI + " " + f.tailPivot.x + " " + f.tailPivot.y + ")",
    );

    const pecRot =
      (0.1 + 0.14 * (1 - Math.min(1, f.state.speedNorm))) *
      Math.sin(f.state.beatPhase * 1.7 + f.phase + 1.3);
    f.frontEl.setAttribute(
      "transform",
      "rotate(" + (pecRot * 180) / Math.PI + " " + f.pectoralPivot.x + " " + f.pectoralPivot.y + ")",
    );
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
`;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Molly tank animation preview</title>
<style>
  html, body { margin:0; height:100%; font-family: -apple-system, "Segoe UI", sans-serif; background:#04121d; color:#eaf6ff; }
  header { padding:12px 20px; }
  h1 { font-size:16px; margin:0 0 4px; }
  p { font-size:12px; color:#8fb3cc; margin:0; max-width:760px; }
  #tank { position:relative; overflow:hidden; margin:0 20px 20px;
          height:calc(100vh - 96px);
          background: linear-gradient(180deg, #0b3a5c 0%, #063049 55%, #02131f 100%);
          border-radius:12px; }
  #sand { position:absolute; left:0; right:0; bottom:0; height:12%; min-height:32px; max-height:64px;
          background:#c9b48a; opacity:0.85; }
  .fish { position:absolute; left:0; top:0; will-change: transform; }
  .fish svg { display:block; overflow:visible; }
</style></head><body>
<header>
  <h1>🐟 Molly tank animation preview — ${FISH_COUNT} fish</h1>
  <p>Generated by scripts/fish-tank-preview.ts. Art from render-spec.ts, swim physics from
  swim-model.ts (bundled, not reimplemented) — only the transform composition around them is
  ported to CSS/JS. Body-mesh undulation isn't reproducible outside Skia and is skipped here;
  everything else (swim path, turns, tail beat, pectoral flutter) is faithful. Regenerate with
  <code>yarn fish:tank-preview</code>.</p>
</header>
<div id="tank">
  <div id="sand"></div>
  ${fishMarkup}
</div>
<script>${swimModelJs}</script>
<script>
const FISH_DATA = [
  ${fishInitJs}
];
const tank = document.getElementById("tank");
${driverJs}
</script>
</body></html>`;

const outPath = join(root, "src/docs/fish-tank-preview.html");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, html);
console.log(`Wrote ${outPath}`);
