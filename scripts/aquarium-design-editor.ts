// Interactive designer for the (now the app's only) 2D fish
// (`src/shared/aquarium/`): a tiny local server + browser UI, in the same
// spirit as `tank-design-editor.ts` (3D tank/fish) and the old renderer's
// now-deleted `fish-color-editor.ts` — but this tree had NEITHER an
// interactive shape editor NOR a swim-motion tuner before this (only the
// static `yarn aquarium:preview` gallery). See `src/docs/aquarium-guide.md`
// before changing anything this reads from.
//
// Two independent tabs, two different save models — deliberately not the
// same model, see each section below for why:
//
// Shape tab (body/fins): drag control points, see the REAL bake
// (`bakeFish`) update live via `/api/bake`. Save is Copy-code only, like
// `fish:colors` — `body-profile.ts`/`fins.ts` carry meaningful INLINE
// comments per point/fin ("crest, forward of centre", "HARD CAP: past
// ~1.6·H...") that a regenerated literal would silently drop, so this tool
// never touches those files on disk.
//
// Motion tab (sim/swim.ts): drag sliders, watch the REAL `stepV2Swim`
// (bundled straight into the browser, not reimplemented) animate real
// baked-fish sprites via the REAL `screenTransformFor`. Save DOES write
// `sim/swim.ts` directly — its tunables are simple `const NAME = value;`
// lines with the "why" living in comments around them, not inline per
// point, so `scripts/lib/swim-const-patch.ts` can replace just the number
// on each line and leave every comment untouched.
//
// Run: yarn aquarium:design   (http://127.0.0.1:5479, override with PORT=)

import { createServer, type IncomingMessage } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";

import { loadSkiaNode } from "./lib/skia-node";
import { readSwimConstants, patchSwimConstants, type SwimConstName } from "./lib/swim-const-patch";
import { bakeFish, densityAwareDpr } from "@/shared/aquarium/fish/bake-fish";
import {
  ANAL_FIN,
  CAUDAL_FIN,
  DORSAL_FIN,
  PECTORAL_FAR_FIN,
  PECTORAL_NEAR_FIN,
  PELVIC_FAR_FIN,
  PELVIC_NEAR_FIN,
  type FinSpec,
} from "@/shared/aquarium/fish/fins";
import { BODY_PROFILES, type BodyProfile } from "@/shared/aquarium/fish/body-profile";
import { COLOR_DEFS } from "@/shared/fish/catalog";
import type { BodyId, DorsalId, FishTraits, LifeStage, TailId } from "@/shared/fish/types";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const SWIM_PATH = join(root, "src/shared/aquarium/sim/swim.ts");
const PORT = Number(process.env.PORT) || 5479;

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(err as Error);
      }
    });
    req.on("error", reject);
  });
}

// Pristine snapshots, taken once at boot — what "Reset" in the Shape tab
// restores to, and what the browser starts editing from. `/api/bake`
// mutates the REAL imported `BODY_PROFILES`/fin tables in place (see the
// header comment) so `bakeFish` — which reads those same module-scope
// objects, not a parameter — bakes exactly what's being edited.
const PRISTINE_BODY_PROFILES: Record<BodyId, BodyProfile> = structuredClone(BODY_PROFILES);
const PRISTINE_FINS = {
  dorsal: structuredClone(DORSAL_FIN),
  anal: structuredClone(ANAL_FIN),
  pelvicNear: structuredClone(PELVIC_NEAR_FIN),
  pelvicFar: structuredClone(PELVIC_FAR_FIN),
  pectoralNear: structuredClone(PECTORAL_NEAR_FIN),
  pectoralFar: structuredClone(PECTORAL_FAR_FIN),
  caudal: structuredClone(CAUDAL_FIN),
};

interface ShapeState {
  bodyProfiles: Record<BodyId, BodyProfile>;
  fins: {
    dorsal: Record<DorsalId, FinSpec>;
    anal: FinSpec;
    pelvicNear: FinSpec;
    pelvicFar: FinSpec;
    pectoralNear: FinSpec;
    pectoralFar: FinSpec;
    caudal: Record<TailId, FinSpec>;
  };
}

/** Overwrites the REAL module-scope tables with `state` — see the header comment on why bakeFish needs this rather than a parameter. */
function applyShapeState(state: ShapeState): void {
  BODY_PROFILES.standard = state.bodyProfiles.standard;
  BODY_PROFILES.balloon = state.bodyProfiles.balloon;
  DORSAL_FIN.standard = state.fins.dorsal.standard;
  DORSAL_FIN.sailfin = state.fins.dorsal.sailfin;
  Object.assign(ANAL_FIN, state.fins.anal);
  Object.assign(PELVIC_NEAR_FIN, state.fins.pelvicNear);
  Object.assign(PELVIC_FAR_FIN, state.fins.pelvicFar);
  Object.assign(PECTORAL_NEAR_FIN, state.fins.pectoralNear);
  Object.assign(PECTORAL_FAR_FIN, state.fins.pectoralFar);
  CAUDAL_FIN.round = state.fins.caudal.round;
  CAUDAL_FIN.lyretail = state.fins.caudal.lyretail;
}

const BUNDLE_ALIAS: Record<string, string> = {
  "@/shared/lib/swim-model": join(root, "src/shared/lib/swim-model.ts"),
  "@/shared/constants/tank": join(root, "src/shared/constants/tank.ts"),
  "@/shared/aquarium/core/ir": join(root, "src/shared/aquarium/core/ir.ts"),
  "@/shared/fish/types": join(root, "src/shared/fish/types.ts"),
};

/** Bundle the studio's pure math for the browser, fresh on every page load — the existing tools' "edit source, hit refresh" convention. */
function buildClient(): string {
  const out = esbuild.buildSync({
    stdin: {
      contents: `
        import { sampleBodyCurve, finContextFor, buildFin } from "./lib/aquarium-shape-preview";
        import { stepV2Swim, initV2SwimState, currentAt, Z_MAX } from "../src/shared/aquarium/sim/swim";
        import { screenTransformFor } from "../src/shared/aquarium/render/screen-transform";
        window.__aquariumLib = Object.assign(window.__aquariumLib || {}, {
          sampleBodyCurve, finContextFor, buildFin,
          stepV2Swim, initV2SwimState, currentAt, Z_MAX,
          screenTransformFor,
        });
      `,
      resolveDir: here,
      loader: "ts",
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2020",
    alias: BUNDLE_ALIAS,
  });
  return out.outputFiles[0].text;
}

/**
 * A virtual esbuild module standing in for `sim/swim.ts`, its content
 * `patchSwimConstants`-patched with the Motion tab's LIVE slider values
 * (never written to disk — that's what Save is for). `stepV2Swim` closes
 * over its own module-scope tuned consts rather than taking them as
 * parameters (by design — production callers shouldn't carry that surface),
 * so the only way to make a slider retune the RUNNING simulation is to
 * rebuild the module with the new numbers baked in and swap the function
 * reference the animation loop calls — this plugin is what lets that
 * rebuild happen from an in-memory string instead of a temp file on disk.
 */
function patchedSwimPlugin(patchedSource: string): esbuild.Plugin {
  const VIRTUAL = "virtual:swim-patched";
  return {
    name: "patched-swim",
    setup(build) {
      build.onResolve({ filter: /^virtual:swim-patched$/ }, () => ({
        path: VIRTUAL,
        namespace: "patched-swim",
      }));
      build.onLoad({ filter: /.*/, namespace: "patched-swim" }, () => ({
        contents: patchedSource,
        loader: "ts",
      }));
    },
  };
}

/**
 * Rebuilds just the swim-simulation slice of `window.__aquariumLib` against
 * `changes`, so the Motion tab's already-running animation loop (which
 * looks up `lib.stepV2Swim` fresh every frame) picks up tuned behaviour on
 * the very next frame — no re-seeding, no page reload. `screenTransformFor`
 * is deliberately NOT part of this rebuild (see the Motion tab's UI hint):
 * it stays on the page-load bundle's `Z_MAX`, so tuning `Z_MAX` specifically
 * lags by one page reload on its (minor, cosmetic) depth-scale term while
 * every other constant — the ones that actually drive steering — applies
 * live.
 */
async function buildMotionBundle(
  swimSource: string,
  changes: Partial<Record<SwimConstName, number>>,
): Promise<string> {
  const patched = patchSwimConstants(swimSource, changes);
  // esbuild's plugin system requires the async `build()` API — `buildSync`
  // rejects any config with `plugins` set, which is why this one (unlike
  // `buildClient()` above) can't be sync.
  const out = await esbuild.build({
    stdin: {
      contents: `
        import { stepV2Swim, initV2SwimState, currentAt, Z_MAX } from "virtual:swim-patched";
        window.__aquariumLib = Object.assign(window.__aquariumLib || {}, {
          stepV2Swim, initV2SwimState, currentAt, Z_MAX,
        });
      `,
      resolveDir: here,
      loader: "ts",
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2020",
    alias: BUNDLE_ALIAS,
    plugins: [patchedSwimPlugin(patched)],
  });
  return out.outputFiles[0].text;
}

const BODY_IDS: BodyId[] = ["standard", "balloon"];
const TAIL_IDS: TailId[] = ["round", "lyretail"];
const DORSAL_IDS: DorsalId[] = ["standard", "sailfin"];
const sidebarColors = COLOR_DEFS.map((d) => ({ id: d.id, name: d.name }));

function html(clientJs: string, swimConsts: ReturnType<typeof readSwimConstants>): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Molly aquarium designer</title>
<style>
  :root { color-scheme: dark; --bg:#0a1620; --panel:#10222f; --line:#1d3a4d;
          --text:#e8f4ff; --dim:#8fb3cc; --accent:#37b6ff; }
  * { box-sizing: border-box; }
  body { margin:0; height:100vh; display:flex; flex-direction:column; font:13px/1.45 -apple-system,"Segoe UI",sans-serif;
         background:var(--bg); color:var(--text); overflow:hidden; }
  #topbar { flex:none; display:flex; gap:10px; align-items:center; padding:8px 12px;
            background:var(--panel); border-bottom:1px solid var(--line); flex-wrap:wrap; }
  #topbar label { color:var(--dim); }
  select, input[type=number], input[type=text] { background:#0a1a24; color:var(--text);
          border:1px solid var(--line); border-radius:4px; padding:3px 6px; font:inherit; }
  #tabs { display:inline-flex; }
  #tabs button { border-radius:0; margin:0; }
  #tabs button:first-child { border-radius:6px 0 0 6px; }
  #tabs button:last-child { border-radius:0 6px 6px 0; border-left-width:0; }
  #tabs button.on { background:var(--accent); color:#052030; font-weight:600; }
  button.act { background:#16394f; color:var(--text); border:1px solid var(--line);
               border-radius:6px; padding:5px 11px; cursor:pointer; font:inherit; }
  button.act:hover { border-color:var(--accent); }
  button.act.primary { background:var(--accent); color:#052030; font-weight:600; border-color:transparent; }
  #body { flex:1; min-height:0; display:flex; }
  #nav { width:170px; flex:none; background:var(--panel); border-right:1px solid var(--line);
         overflow-y:auto; padding:8px 0; }
  #nav button { display:block; width:100%; text-align:left; padding:7px 14px; background:none;
                border:0; color:var(--dim); cursor:pointer; font:inherit; }
  #nav button:hover { background:#16304180; color:var(--text); }
  #nav button.on { background:#16394f; color:var(--text); box-shadow:inset 3px 0 var(--accent); }
  #nav .changed::after { content:"•"; color:var(--accent); margin-left:5px; }
  #stage { flex:1; display:flex; flex-direction:column; min-width:0; position:relative; }
  #panel { width:340px; flex:none; background:var(--panel); border-left:1px solid var(--line);
           overflow-y:auto; padding:10px 12px 40px; }
  h2 { font-size:13px; margin:2px 0 10px; color:var(--accent); text-transform:uppercase; letter-spacing:.06em; }
  h3 { font-size:12px; margin:14px 0 6px; color:var(--dim); border-bottom:1px solid var(--line); padding-bottom:3px; }
  .row { display:flex; align-items:center; gap:6px; margin:3px 0; }
  .row > span { flex:1; color:var(--dim); font-size:11.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .row input[type=range] { flex:1.3; min-width:0; accent-color:var(--accent); }
  .row input[type=number] { width:66px; }
  .hint { color:#54788f; font-size:11px; margin:6px 0 0; }
  .doc { color:#6d93ab; font-size:11px; margin:1px 0 6px; line-height:1.4; }
  #shapeSvg { width:100%; flex:1; min-height:0; background:#0a1a24; touch-action:none; cursor:crosshair; }
  #bakedPreview { position:absolute; right:14px; top:14px; width:150px; height:150px;
                  background:#0a1a24; border:1px solid var(--line); border-radius:8px;
                  display:flex; align-items:center; justify-content:center; overflow:hidden; }
  #bakedPreview img { max-width:100%; max-height:100%; image-rendering:pixelated; }
  #motionCanvas { width:100%; flex:1; min-height:0; background:#0a1a24; }
  .tiprow { display:flex; align-items:center; gap:5px; margin:3px 0; }
  .tiprow > b { flex:none; width:34px; color:var(--dim); font-weight:400; font-size:11px; }
  .tiprow input { width:100%; min-width:0; }
  .tiprow button { flex:none; background:#0a1a24; color:var(--dim); border:1px solid var(--line);
                   border-radius:4px; cursor:pointer; width:22px; }
  #toast { position:fixed; left:50%; bottom:22px; transform:translateX(-50%); padding:8px 16px;
           background:#16394f; border:1px solid var(--accent); border-radius:8px;
           opacity:0; transition:opacity .18s; pointer-events:none; z-index:10; }
  #toast.show { opacity:1; }
  #copyBox { position:fixed; inset:0; background:#000000a0; display:none; align-items:center; justify-content:center; z-index:20; }
  #copyBox.show { display:flex; }
  #copyBox textarea { width:min(720px,86vw); height:min(60vh,500px); background:#0a1a24; color:var(--text);
                       border:1px solid var(--accent); border-radius:8px; padding:10px; font:12px ui-monospace,monospace; }
  #copyWrap { display:flex; flex-direction:column; gap:8px; }
</style></head><body>
<div id="topbar">
  <span id="tabs">
    <button class="act tab on" data-tab="shape">Shape</button>
    <button class="act tab" data-tab="motion">Motion</button>
  </span>
  <span id="shapeControls">
    <label>Color <select id="color"></select></label>
    <label>Body <select id="body"></select></label>
    <label>Tail <select id="tail"></select></label>
    <label>Dorsal <select id="dorsal"></select></label>
  </span>
  <span id="motionControls" style="display:none">
    <label>Fish <input id="fishCount" type="number" min="1" max="20" value="8" style="width:52px"></label>
    <label><input id="currentToggle" type="checkbox"> Shared current</label>
    <label><input id="pauseToggle" type="checkbox"> Pause</label>
  </span>
  <span style="flex:1"></span>
  <button class="act" id="resetBtn">Reset tab</button>
  <button class="act" id="copyBtn">Copy code</button>
  <button class="act primary" id="saveBtn" style="display:none">Save to sim/swim.ts</button>
</div>
<div id="body">
  <nav id="nav"></nav>
  <div id="stage">
    <div id="shapeView" style="display:flex; flex-direction:column; height:100%">
      <svg id="shapeSvg" viewBox="-90 -55 190 110"></svg>
      <div id="bakedPreview"><span class="hint">baking…</span></div>
    </div>
    <canvas id="motionCanvas" style="display:none"></canvas>
  </div>
  <aside id="panel"></aside>
</div>
<div id="toast"></div>
<div id="copyBox"><div id="copyWrap">
  <textarea id="copyText" readonly></textarea>
  <button class="act primary" id="copyCloseBtn">Close</button>
</div></div>
<script>${clientJs}</script>
<script>
const lib = window.__aquariumLib;
const BODY_PROFILES = ${JSON.stringify(PRISTINE_BODY_PROFILES)};
const FIN_DEFAULTS = ${JSON.stringify(PRISTINE_FINS)};
const SWIM_DEFAULTS = ${JSON.stringify(swimConsts)};
const COLORS = ${JSON.stringify(sidebarColors)};
const BODY_IDS = ${JSON.stringify(BODY_IDS)};
const TAIL_IDS = ${JSON.stringify(TAIL_IDS)};
const DORSAL_IDS = ${JSON.stringify(DORSAL_IDS)};

const clone = (o) => JSON.parse(JSON.stringify(o));
const round3 = (n) => Math.round(n * 1000) / 1000;

let tab = "shape";
let shape = { bodyProfiles: clone(BODY_PROFILES), fins: clone(FIN_DEFAULTS) };
let swim = Object.fromEntries(SWIM_DEFAULTS.map((c) => [c.name, c.value]));

let bodyId = "standard", tailId = "round", dorsalId = "standard", colorId = COLORS[0].id;

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 1800);
}

// ---------------------------------------------------------------------------
// Shape tab
// ---------------------------------------------------------------------------

const PARTS = [
  { id: "body", label: "Body" },
  { id: "dorsal", label: "Dorsal" },
  { id: "anal", label: "Anal" },
  { id: "pelvicNear", label: "Pelvic (near)" },
  { id: "pelvicFar", label: "Pelvic (far)" },
  { id: "pectoralNear", label: "Pectoral (near)" },
  { id: "pectoralFar", label: "Pectoral (far)" },
  { id: "caudal", label: "Caudal" },
];
let activePart = "body";

function currentProfile() { return shape.bodyProfiles[bodyId]; }
function currentFin(part) {
  if (part === "dorsal") return shape.fins.dorsal[dorsalId];
  if (part === "caudal") return shape.fins.caudal[tailId];
  return shape.fins[part];
}

const undoStack = [];
function pushUndo() {
  undoStack.push(JSON.stringify(shape));
  if (undoStack.length > 60) undoStack.shift();
}
window.addEventListener("keydown", (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
  if (tab !== "shape") return;
  const prev = undoStack.pop();
  if (!prev) return;
  e.preventDefault();
  shape = JSON.parse(prev);
  renderShapePanel();
  drawShape();
  scheduleBake();
});

const svg = document.getElementById("shapeSvg");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

function handle(id, x, y, label, color) {
  return '<g data-h="' + esc(id) + '" style="cursor:grab">' +
    '<circle cx="' + x + '" cy="' + y + '" r="1.6" fill="' + color + '" stroke="#0a1620" stroke-width="0.4"/>' +
    (label ? '<text x="' + (x + 2.2) + '" y="' + (y - 1.8) + '" fill="#8fb3cc" font-size="3" style="pointer-events:none">' + esc(label) + "</text>" : "") +
    "</g>";
}

function drawShape() {
  const profile = currentProfile();
  const curve = lib.sampleBodyCurve(profile, 90);
  const poly = (pts) => pts.map((p) => p.x + "," + p.y).join(" ");
  let s = '<line x1="-90" y1="0" x2="100" y2="0" stroke="#1d3a4d" stroke-width="0.3"/>' +
    '<polygon points="' + poly(curve.top) + " " + poly([...curve.bottom].reverse()) + '" ' +
    'fill="#37b6ff14" stroke="#37b6ff" stroke-width="0.5"/>';

  const ctx = lib.finContextFor(profile, bodyId);
  const finEntries = [
    ["dorsal", shape.fins.dorsal[dorsalId]],
    ["anal", shape.fins.anal],
    ["pelvicNear", shape.fins.pelvicNear],
    ["pelvicFar", shape.fins.pelvicFar],
    ["pectoralNear", shape.fins.pectoralNear],
    ["pectoralFar", shape.fins.pectoralFar],
    ["caudal", shape.fins.caudal[tailId]],
  ];
  const built = {};
  for (const [key, spec] of finEntries) {
    const fin = lib.buildFin(spec, ctx);
    built[key] = fin;
    const on = key === activePart;
    s += '<path d="' + fin.d + '" fill="' + (on ? "#ffd18a33" : "#ffffff0a") + '" stroke="' +
      (on ? "#ffd18a" : "#4a708a") + '" stroke-width="0.4"/>';
  }

  if (activePart === "body") {
    profile.top.forEach((p, i) => {
      const x = profile.x0 + p.x * profile.length;
      s += handle("top:" + i, x, -p.y, "", "#e8f4ff");
    });
    profile.bottom.forEach((p, i) => {
      const x = profile.x0 + p.x * profile.length;
      s += handle("bottom:" + i, x, p.y, "", "#ffd18a");
    });
  } else {
    const fin = built[activePart];
    s += handle("pivot", fin.pivot.x, fin.pivot.y, "hub", "#37b6ff");
    fin.tips.forEach((t, i) => {
      s += handle("tip:" + i, t.x, t.y, "t" + i, "#ffd18a");
    });
  }
  svg.innerHTML = s;
}

let dragging = null;
const cursor = svg.createSVGPoint();
function toLocal(e) {
  cursor.x = e.clientX; cursor.y = e.clientY;
  const p = cursor.matrixTransform(svg.getScreenCTM().inverse());
  return { x: p.x, y: p.y };
}
svg.addEventListener("pointerdown", (e) => {
  const g = e.target.closest && e.target.closest("g[data-h]");
  if (!g) return;
  pushUndo();
  dragging = g.dataset.h;
  svg.setPointerCapture(e.pointerId);
});
svg.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  const { x, y } = toLocal(e);
  if (activePart === "body") {
    const profile = currentProfile();
    const [side, idxStr] = dragging.split(":");
    const idx = Number(idxStr);
    const arr = profile[side];
    const u = round3((x - profile.x0) / profile.length);
    const gap = 0.01;
    const lo = idx > 0 ? arr[idx - 1].x + gap : -Infinity;
    const hi = idx < arr.length - 1 ? arr[idx + 1].x - gap : Infinity;
    arr[idx].x = Math.min(Math.max(u, lo), hi);
    arr[idx].y = Math.max(0.5, round3(side === "top" ? -y : y));
  } else {
    const spec = currentFin(activePart);
    const ctx = lib.finContextFor(currentProfile(), bodyId);
    const fin = lib.buildFin(spec, ctx);
    const ref = spec.ref === "H" ? ctx.halfHeight : ctx.length;
    if (dragging === "pivot") {
      // Hub position is derived from uRoot/side/sink, not directly
      // draggable — see the "sink" / "uRoot" numeric fields instead.
    } else if (dragging.startsWith("tip:")) {
      const i = Number(dragging.slice(4));
      const dx = x - fin.pivot.x, dy = y - fin.pivot.y;
      const lenFrac = round3(Math.hypot(dx, dy) / ref);
      let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      let dAngleDeg = angle - spec.axisDeg;
      while (dAngleDeg > 180) dAngleDeg -= 360;
      while (dAngleDeg <= -180) dAngleDeg += 360;
      spec.rays[i] = { dAngleDeg: round3(dAngleDeg), lenFrac: Math.max(0.02, lenFrac) };
    }
  }
  drawShape();
  syncShapeFields();
  scheduleBake();
});
const stopDrag = () => { dragging = null; };
svg.addEventListener("pointerup", stopDrag);
svg.addEventListener("pointercancel", stopDrag);

function numField(label, obj, key, step) {
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = '<span title="' + label + '">' + label + "</span>";
  const box = document.createElement("input");
  box.type = "number"; box.step = step ?? 0.1; box.value = obj[key];
  box.addEventListener("change", () => {
    const n = Number(box.value);
    if (!Number.isFinite(n)) { box.value = obj[key]; return; }
    pushUndo();
    obj[key] = n;
    drawShape(); scheduleBake();
  });
  row.append(box);
  return row;
}

function bulgeFields(spec) {
  const wrap = document.createElement("div");
  const segCount = spec.rays.length - 1;
  if (Array.isArray(spec.bulge)) {
    for (let i = 0; i < segCount; i++) {
      wrap.append(numField("bulge[" + i + "]", spec.bulge, i, 0.02));
    }
  } else {
    wrap.append(numField("bulge (all segments)", spec, "bulge", 0.02));
  }
  const toggle = document.createElement("button");
  toggle.className = "act";
  toggle.textContent = Array.isArray(spec.bulge) ? "Use one value" : "Use per-segment";
  toggle.addEventListener("click", () => {
    pushUndo();
    spec.bulge = Array.isArray(spec.bulge)
      ? spec.bulge[0] ?? 0.15
      : new Array(segCount).fill(spec.bulge);
    drawShape(); syncShapeFields(); scheduleBake();
  });
  wrap.append(toggle);
  return wrap;
}

function syncShapeFields() {
  const panel = document.getElementById("panel");
  panel.innerHTML = "";
  const h = document.createElement("h2");
  h.textContent = PARTS.find((p) => p.id === activePart).label;
  panel.append(h);

  if (activePart === "body") {
    const profile = currentProfile();
    const tip = document.createElement("p");
    tip.className = "hint";
    tip.textContent = "Drag any control point. White = top curve, amber = bottom curve. Points can't cross their neighbours.";
    panel.append(tip);
    panel.append(numField("x0 (nose plane)", profile, "x0", 1));
    panel.append(numField("length", profile, "length", 1));
    const note = document.createElement("p");
    note.className = "hint";
    note.textContent = "Copy code (top bar) to paste this back into body-profile.ts — Save doesn't write to disk here, see the header comment on why. Run yarn verify:aquarium after pasting.";
    panel.append(note);
    return;
  }

  const spec = currentFin(activePart);
  const tip = document.createElement("p");
  tip.className = "hint";
  tip.textContent = "Drag ray tips to reshape the membrane. Hub position comes from uRoot/sink below, not dragging.";
  panel.append(tip);
  panel.append(numField("uRoot (0=nose,1=peduncle)", spec, "uRoot", 0.01));
  panel.append(numField("sink", spec, "sink", 0.5));
  panel.append(numField("axisDeg", spec, "axisDeg", 1));
  const h3 = document.createElement("h3");
  h3.textContent = "Margin";
  panel.append(h3);
  panel.append(bulgeFields(spec));
  panel.append(numField("scallop", spec, "scallop", 0.01));
  panel.append(numField("alpha", spec, "alpha", 0.05));
  panel.append(numField("rayAlpha", spec, "rayAlpha", 0.02));

  const h4 = document.createElement("h3");
  h4.textContent = "Rays (" + spec.rays.length + ")";
  panel.append(h4);
  spec.rays.forEach((r, i) => {
    const del = document.createElement("button");
    del.textContent = "×";
    del.disabled = spec.rays.length <= 2;
    del.title = "Remove ray";
    del.addEventListener("click", () => {
      pushUndo();
      spec.rays.splice(i, 1);
      if (Array.isArray(spec.bulge)) spec.bulge.splice(Math.max(0, i - 1), 1);
      drawShape(); syncShapeFields(); scheduleBake();
    });
    const row = document.createElement("div");
    row.className = "tiprow";
    const b = document.createElement("b");
    b.textContent = "r" + i;
    row.append(b, del);
    panel.append(row);
  });
  const add = document.createElement("button");
  add.className = "act";
  add.textContent = "+ ray";
  add.addEventListener("click", () => {
    pushUndo();
    const last = spec.rays[spec.rays.length - 1];
    const prev = spec.rays[spec.rays.length - 2] ?? { dAngleDeg: last.dAngleDeg - 20, lenFrac: last.lenFrac };
    spec.rays.push({
      dAngleDeg: round3(last.dAngleDeg + (last.dAngleDeg - prev.dAngleDeg) * 0.5),
      lenFrac: round3(last.lenFrac + (last.lenFrac - prev.lenFrac) * 0.5),
    });
    if (Array.isArray(spec.bulge)) spec.bulge.push(spec.bulge[spec.bulge.length - 1] ?? 0.15);
    drawShape(); syncShapeFields(); scheduleBake();
  });
  panel.append(add);

  const note = document.createElement("p");
  note.className = "hint";
  note.textContent = "Copy code (top bar) to paste this back into fins.ts — Save doesn't write to disk here, see the header comment on why. Run yarn verify:aquarium after pasting.";
  panel.append(note);
}

let bakeTimer = null;
function scheduleBake() {
  clearTimeout(bakeTimer);
  bakeTimer = setTimeout(runBake, 180);
}
async function runBake() {
  const img = document.querySelector("#bakedPreview img") || document.createElement("img");
  try {
    const res = await fetch("/api/bake", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        traits: { color: colorId, body: bodyId, tail: tailId, dorsal: dorsalId },
        stage: "adult",
        shape,
      }),
    });
    const body = await res.json();
    if (!res.ok) { document.getElementById("bakedPreview").innerHTML = '<span class="hint">' + esc(body.error) + "</span>"; return; }
    img.src = body.dataUri;
    document.getElementById("bakedPreview").innerHTML = "";
    document.getElementById("bakedPreview").append(img);
  } catch (err) {
    document.getElementById("bakedPreview").innerHTML = '<span class="hint">bake failed</span>';
  }
}

function renderShapeNav() {
  const nav = document.getElementById("nav");
  nav.innerHTML = "";
  for (const p of PARTS) {
    const b = document.createElement("button");
    b.textContent = p.label;
    b.className = p.id === activePart ? "on" : "";
    b.addEventListener("click", () => { activePart = p.id; renderShapePanel(); });
    nav.append(b);
  }
}

function renderShapePanel() {
  renderShapeNav();
  drawShape();
  syncShapeFields();
}

// ---------------------------------------------------------------------------
// Motion tab
// ---------------------------------------------------------------------------

const SWIM_GROUPS = [
  { label: "Turning", names: ["TURN_RATE_MIN", "TURN_RATE_MAX_WALL", "TURN_RATE_BURST", "TURN_RATE_TAU"] },
  { label: "Speed / accel", names: ["ACCEL_TAU", "DECEL_TAU", "TURN_SPEED_PENALTY_MAX", "MAX_DT"] },
  { label: "Wander / walls", names: ["WALL_MARGIN_X", "WALL_MARGIN_Z", "ARRIVE_RADIUS", "HOVER_JITTER", "VERTICAL_WANDER", "Z_MAX", "Y_TAU"] },
  { label: "Banking / pitch", names: ["ROLL_GAIN", "ROLL_MAX", "ROLL_TAU", "PITCH_TAU", "BROADSIDE_BIAS"] },
  { label: "Shared current", names: ["CURRENT_FREQ", "CURRENT_DRIFT_MAX"] },
];
const swimInfo = Object.fromEntries(SWIM_DEFAULTS.map((c) => [c.name, c]));
let activeSwimGroup = SWIM_GROUPS[0].label;

function renderSwimNav() {
  const nav = document.getElementById("nav");
  nav.innerHTML = "";
  for (const g of SWIM_GROUPS) {
    const b = document.createElement("button");
    b.textContent = g.label;
    b.className = (g.label === activeSwimGroup ? "on " : "") + (g.names.some((n) => swim[n] !== swimInfo[n].value) ? "changed" : "");
    b.addEventListener("click", () => { activeSwimGroup = g.label; renderSwimPanel(); });
    nav.append(b);
  }
}

function swimSlider(name) {
  const info = swimInfo[name];
  const row = document.createElement("div");
  const label = document.createElement("div");
  label.className = "row";
  label.innerHTML = '<span title="' + esc(name) + '">' + name + "</span>";
  const range = document.createElement("input");
  const box = document.createElement("input");
  box.type = "number"; box.step = 0.01;
  const v0 = info.value;
  const span = Math.max(Math.abs(v0) * 2, 0.5);
  range.type = "range"; range.min = Math.min(0, v0 - span); range.max = v0 + span; range.step = span / 200;
  range.value = swim[name]; box.value = swim[name];
  const set = (n) => {
    if (!Number.isFinite(n)) return;
    swim[name] = n; range.value = n; box.value = n;
    renderSwimNav();
    scheduleMotionApply();
  };
  range.addEventListener("input", () => set(Number(range.value)));
  box.addEventListener("change", () => set(Number(box.value)));
  label.append(range, box);
  row.append(label);
  if (info.doc) {
    const doc = document.createElement("div");
    doc.className = "doc";
    doc.textContent = info.doc;
    row.append(doc);
  }
  return row;
}

function renderSwimPanel() {
  renderSwimNav();
  const panel = document.getElementById("panel");
  panel.innerHTML = "";
  const h = document.createElement("h2");
  h.textContent = activeSwimGroup;
  panel.append(h);
  const group = SWIM_GROUPS.find((g) => g.label === activeSwimGroup);
  for (const name of group.names) panel.append(swimSlider(name));
  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = activeSwimGroup === "Wander / walls"
    ? "Sliders retune the running simulation live (~200ms). Exception: Z_MAX's effect on the on-screen depth-scale term needs a page reload to update — its effect on steering bounds applies live either way. Save writes sim/swim.ts, then run yarn verify:aquarium."
    : "Sliders retune the running simulation live (~200ms after you stop dragging). Save writes sim/swim.ts directly — run yarn verify:aquarium afterward.";
  panel.append(hint);
}

// A lightweight body+caudal silhouette (straight-line polygons, not the
// real curved fin membrane — the Shape tab already shows the real bake at
// full fidelity; this tab is for tuning MOTION) drawn via the SAME
// screenTransformFor fish-layer.tsx uses, so turning/banking/speed read
// exactly as they would in the app.
function fishPolygons() {
  const profile = currentProfile();
  const curve = lib.sampleBodyCurve(profile, 48);
  const ctx = lib.finContextFor(profile, bodyId);
  const caudal = lib.buildFin(shape.fins.caudal[tailId], ctx);
  const body = [...curve.top, ...[...curve.bottom].reverse()];
  const fin = [caudal.pivot, ...caudal.tips, caudal.pivot];
  const xs = body.map((p) => p.x).concat(fin.map((p) => p.x));
  const width = Math.max(...xs) - Math.min(...xs);
  return { body, fin, width };
}

/**
 * screenTransformFor's matrixW/matrixCosRoll/matrixQ is a genuine Skia
 * projective transform (persp0 = q, per SkMatrix's row-major 3x3 — see
 * toMatrix3 in react-native-skia's own Matrix4.ts), NOT a plain
 * translation: x' = (w*x) / (1 + q*x). Canvas 2D's ctx.transform() can
 * only express affine (6-parameter) transforms, so this projects each
 * point by hand instead of trying to fake the divide with ctx.transform.
 * Composition order matches the Transforms3d list fish-layer.tsx builds
 * (translate, rotate, matrix, scale) applied innermost-first to the point:
 * scale, then the projective matrix, then rotate, then translate.
 */
function projectPoint(p, t) {
  const x = p.x * t.scaleX;
  const y = p.y * t.scaleY;
  const denom = 1 + t.matrixQ * x;
  const mx = (t.matrixW * x) / denom;
  const my = (t.matrixCosRoll * y) / denom;
  const cr = Math.cos(t.rotate), sr = Math.sin(t.rotate);
  return {
    x: t.translateX + mx * cr - my * sr,
    y: t.translateY + mx * sr + my * cr,
  };
}

function drawPolygon(points, t, fillStyle) {
  cctx.beginPath();
  points.forEach((p, i) => {
    const s = projectPoint(p, t);
    if (i === 0) cctx.moveTo(s.x, s.y);
    else cctx.lineTo(s.x, s.y);
  });
  cctx.closePath();
  cctx.fillStyle = fillStyle;
  cctx.fill();
}

const canvas = document.getElementById("motionCanvas");
const cctx = canvas.getContext("2d");
let fishes = [];
let box = { minX: 40, maxX: 350, minY: 40, maxY: 260 };
let raf = null;
let lastT = null;
let paused = false;
let currentOn = false;

function resizeCanvas() {
  const r = canvas.parentElement.getBoundingClientRect();
  canvas.width = r.width; canvas.height = r.height;
  box = { minX: 30, maxX: canvas.width - 30, minY: 30, maxY: canvas.height - 30 };
}

function seedFishes(n) {
  fishes = Array.from({ length: n }, (_, i) => ({
    seed: i / n,
    state: lib.initV2SwimState(box, i / n),
  }));
}

function stepAndDraw(tMs) {
  if (!lastT) lastT = tMs;
  const dt = Math.min(0.064, (tMs - lastT) / 1000);
  lastT = tMs;
  cctx.clearRect(0, 0, canvas.width, canvas.height);
  cctx.strokeStyle = "#1d3a4d";
  cctx.strokeRect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY);

  const { body, fin, width } = fishPolygons();
  for (const f of fishes) {
    if (!paused) {
      lib.stepV2Swim(f.state, box, dt, 1, f.seed * Math.PI * 2, Math.random, currentOn ? 1 : 0);
    }
    const s = f.state;
    const t = lib.screenTransformFor({
      x: s.x, y: s.y, z: s.z, yaw: s.yaw, roll: s.roll, pitch: s.pitch,
      beatPhase: s.beatPhase, speedNorm: s.speedNorm,
      depthScale: 1, bakedWidth: width,
    });
    drawPolygon(body, t, "#7fd7ff");
    drawPolygon(fin, t, "#ffd18a99");
  }
  raf = requestAnimationFrame(stepAndDraw);
}

function mountMotion() {
  resizeCanvas();
  seedFishes(Number(document.getElementById("fishCount").value) || 8);
  if (raf) cancelAnimationFrame(raf);
  lastT = null;
  raf = requestAnimationFrame(stepAndDraw);
}

// stepV2Swim closes over its own module-scope tuned consts (by design —
// production callers shouldn't carry that surface as parameters), so a
// slider can't retune the ALREADY-BUNDLED function in place. Instead this
// asks the server to rebuild just that slice of the bundle against the
// current slider values (POST /api/motion-bundle — see its doc comment in
// aquarium-design-editor.ts) and injects the result, which reassigns
// lib.stepV2Swim etc. The animation loop above looks those up fresh every
// frame, so the very next frame already steers with the new numbers — no
// re-seed, no reload.
let motionBundleTimer = null;
function scheduleMotionApply() {
  clearTimeout(motionBundleTimer);
  motionBundleTimer = setTimeout(applyMotionBundle, 200);
}
async function applyMotionBundle() {
  const changes = Object.fromEntries(Object.entries(swim).filter(([n, v]) => v !== swimInfo[n].value));
  try {
    const res = await fetch("/api/motion-bundle", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ changes }),
    });
    const body = await res.json();
    if (!res.ok) { toast("Motion rebuild failed: " + body.error); return; }
    const s = document.createElement("script");
    s.textContent = body.js;
    document.body.appendChild(s);
    s.remove();
  } catch {
    toast("Motion rebuild failed — check the server log");
  }
}

window.addEventListener("resize", () => { if (tab === "motion") resizeCanvas(); });

// ---------------------------------------------------------------------------
// Tabs / top bar / save / copy
// ---------------------------------------------------------------------------

function setTab(next) {
  tab = next;
  document.querySelectorAll("#tabs .tab").forEach((b) => b.classList.toggle("on", b.dataset.tab === next));
  document.getElementById("shapeControls").style.display = next === "shape" ? "" : "none";
  document.getElementById("motionControls").style.display = next === "motion" ? "" : "none";
  document.getElementById("shapeView").style.display = next === "shape" ? "flex" : "none";
  document.getElementById("motionCanvas").style.display = next === "motion" ? "block" : "none";
  document.getElementById("saveBtn").style.display = next === "motion" ? "" : "none";
  if (next === "shape") { renderShapePanel(); scheduleBake(); }
  else { renderSwimPanel(); mountMotion(); }
}
document.querySelectorAll("#tabs .tab").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));

const colorSel = document.getElementById("color");
colorSel.innerHTML = COLORS.map((c) => '<option value="' + c.id + '">' + c.name + "</option>").join("");
colorSel.value = colorId;
colorSel.addEventListener("change", () => { colorId = colorSel.value; scheduleBake(); });

const bodySel = document.getElementById("body");
bodySel.innerHTML = BODY_IDS.map((b) => '<option value="' + b + '">' + b + "</option>").join("");
bodySel.value = bodyId;
bodySel.addEventListener("change", () => { bodyId = bodySel.value; renderShapePanel(); scheduleBake(); });

const tailSel = document.getElementById("tail");
tailSel.innerHTML = TAIL_IDS.map((t) => '<option value="' + t + '">' + t + "</option>").join("");
tailSel.value = tailId;
tailSel.addEventListener("change", () => {
  tailId = tailSel.value;
  if (activePart === "caudal") renderShapePanel(); else drawShape();
  scheduleBake();
});

const dorsalSel = document.getElementById("dorsal");
dorsalSel.innerHTML = DORSAL_IDS.map((d) => '<option value="' + d + '">' + d + "</option>").join("");
dorsalSel.value = dorsalId;
dorsalSel.addEventListener("change", () => {
  dorsalId = dorsalSel.value;
  if (activePart === "dorsal") renderShapePanel(); else drawShape();
  scheduleBake();
});

document.getElementById("fishCount").addEventListener("change", () => seedFishes(Number(document.getElementById("fishCount").value) || 8));
document.getElementById("currentToggle").addEventListener("change", (e) => { currentOn = e.target.checked; });
document.getElementById("pauseToggle").addEventListener("change", (e) => { paused = e.target.checked; });

document.getElementById("resetBtn").addEventListener("click", () => {
  if (!confirm("Discard changes on this tab and return to the shipped values?")) return;
  if (tab === "shape") {
    shape = { bodyProfiles: clone(BODY_PROFILES), fins: clone(FIN_DEFAULTS) };
    renderShapePanel(); scheduleBake();
  } else {
    swim = Object.fromEntries(SWIM_DEFAULTS.map((c) => [c.name, c.value]));
    renderSwimPanel();
    toast("Reset — reload the page to see the bundled simulator use shipped values again");
  }
});

function showCopy(text) {
  document.getElementById("copyText").value = text;
  document.getElementById("copyBox").classList.add("show");
}
document.getElementById("copyCloseBtn").addEventListener("click", () => document.getElementById("copyBox").classList.remove("show"));

document.getElementById("copyBtn").addEventListener("click", () => {
  if (tab === "motion") {
    const lines = Object.entries(swim)
      .filter(([n, v]) => v !== swimInfo[n].value)
      .map(([n, v]) => n + " = " + v + ";");
    showCopy(lines.length ? lines.join("\\n") : "(no changes)");
    return;
  }
  if (activePart === "body") {
    const varName = bodyId.toUpperCase();
    showCopy(
      "// Paste into src/shared/aquarium/fish/body-profile.ts, replacing " + varName + ":\\n" +
      "const " + varName + ": BodyProfile = " + serializeLiteral(currentProfile()) + ";"
    );
    return;
  }
  const spec = currentFin(activePart);
  const target =
    activePart === "dorsal" ? "DORSAL_FIN." + dorsalId :
    activePart === "caudal" ? "CAUDAL_FIN." + tailId :
    activePart.toUpperCase().replace(/([A-Z])/g, "_$1").replace(/^_/, "") + "_FIN";
  showCopy(
    "// Paste into src/shared/aquarium/fish/fins.ts, replacing " + target + ":\\n" +
    serializeLiteral(spec) + ";"
  );
});

// Minimal literal serializer mirroring scripts/lib/design-serialize.ts's
// \`literal()\` (kept local since this tool's output shapes — a bare
// BodyProfile or FinSpec, not one big nested design object — differ enough
// that sharing the exact function isn't simpler than a small copy tuned for
// numeric-tuple rays).
function serializeLiteral(value, indent) {
  indent = indent || "";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === "number")) return "[" + value.map(String).join(", ") + "]";
    const inner = indent + "  ";
    return "[\\n" + value.map((v) => inner + serializeLiteral(v, inner) + ",").join("\\n") + "\\n" + indent + "]";
  }
  if (value && typeof value === "object") {
    const inner = indent + "  ";
    const entries = Object.entries(value).map(([k, v]) => inner + k + ": " + serializeLiteral(v, inner) + ",").join("\\n");
    return "{\\n" + entries + "\\n" + indent + "}";
  }
  return String(value);
}

document.getElementById("saveBtn").addEventListener("click", async () => {
  const changes = Object.fromEntries(Object.entries(swim).filter(([n, v]) => v !== swimInfo[n].value));
  if (Object.keys(changes).length === 0) { toast("No changes to save"); return; }
  const res = await fetch("/api/save-swim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ changes }),
  });
  const out = await res.json();
  if (res.ok) toast("Saved sim/swim.ts — run yarn verify:aquarium");
  else alert("Save failed: " + out.error);
});

setTab("shape");
</script>
</body></html>`;
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/") {
    try {
      const swimConsts = readSwimConstants(readFileSync(SWIM_PATH, "utf8"));
      const page = html(buildClient(), swimConsts);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(page);
    } catch (err) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(`Bundle failed:\n\n${(err as Error).message}`);
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/bake") {
    try {
      const body = (await readJson(req)) as {
        traits: FishTraits;
        stage: LifeStage;
        shape: ShapeState;
      };
      applyShapeState(body.shape);
      const Skia = await loadSkiaNode();
      const dpr = densityAwareDpr(2, 1.2);
      const baked = bakeFish(Skia, body.traits, body.stage ?? "adult", dpr);
      if (!baked) throw new Error("bakeFish returned null (bounds collapsed?)");
      const bytes = baked.image.encodeToBytes();
      const dataUri = `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ dataUri }));
    } catch (err) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/motion-bundle") {
    try {
      const body = (await readJson(req)) as { changes: Partial<Record<SwimConstName, number>> };
      const swimSource = readFileSync(SWIM_PATH, "utf8");
      const js = await buildMotionBundle(swimSource, body.changes);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ js }));
    } catch (err) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/save-swim") {
    try {
      const body = (await readJson(req)) as { changes: Partial<Record<SwimConstName, number>> };
      const current = readFileSync(SWIM_PATH, "utf8");
      writeFileSync(SWIM_PATH, patchSwimConstants(current, body.changes));
      console.log("Saved sim/swim.ts:", Object.keys(body.changes).join(", "));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Aquarium designer: http://127.0.0.1:${PORT}`);
  console.log("Shape tab: Copy-code only (body-profile.ts/fins.ts keep their inline comments).");
  console.log("Motion tab: Save writes src/shared/aquarium/sim/swim.ts directly.");
});
