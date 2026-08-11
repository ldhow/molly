// Interactive designer for the 3D tank: a tiny local server + a browser UI
// with a live three.js scene, built from the SAME modules the app renders, so
// what you see is what ships.
//
// Unlike `yarn fish:colors` (which is copy-paste only), Save here writes
// src/shared/components/tank/tank-design.ts directly — that file is pure
// generated-shape config, and copy-pasting ~150 values would be miserable.
// The type definitions and comments at the top of it are preserved; only the
// DEFAULT_TANK_DESIGN literal is rewritten.
//
// The client bundle is rebuilt on every page load, so editing source and
// hitting refresh picks the change up with no rebuild command.
//
// Run: yarn tank:design   (http://127.0.0.1:5478, override with PORT=)

import { createServer, type IncomingMessage } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";

import { DEFAULT_TANK_DESIGN } from "../src/shared/components/tank/tank-design";
import { COLOR_DEFS } from "../src/shared/fish/catalog";
import { serializeDesign } from "./lib/design-serialize";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const DESIGN_PATH = join(root, "src/shared/components/tank/tank-design.ts");
const PORT = Number(process.env.PORT) || 5478;

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

/** Bundle the studio for the browser, fresh, so source edits show on refresh. */
function buildClient(): string {
  const out = esbuild.buildSync({
    stdin: {
      contents: `
        import { mountTankStudio, clearSkinCache } from "./lib/tank-studio";
        import { sampleBodyOutline } from "../src/shared/components/tank/fish-mesh-3d";
        window.__studio = { mountTankStudio, clearSkinCache, sampleBodyOutline };
      `,
      resolveDir: here,
      loader: "ts",
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2020",
    alias: {
      "@/shared/constants/tank": join(root, "src/shared/constants/tank.ts"),
      "@/shared/lib/color": join(root, "src/shared/lib/color.ts"),
      "@/shared/lib/rng": join(root, "src/shared/lib/rng.ts"),
      "@/shared/lib/seed": join(root, "src/shared/lib/seed.ts"),
      "@/shared/lib/swim-model": join(root, "src/shared/lib/swim-model.ts"),
      "@/shared/lib/path2d": join(root, "src/shared/lib/path2d.ts"),
      "@/shared/fish/render-spec": join(root, "src/shared/fish/render-spec.ts"),
      "@/shared/fish/catalog": join(root, "src/shared/fish/catalog.ts"),
    },
  });
  return out.outputFiles[0].text;
}

// Sensible slider bounds. Anything not listed falls back to a heuristic based
// on the current value, which is fine for the long tail of noise seeds and
// frequencies but poor for things with a natural 0..1 range.
const RANGE_HINTS: Record<string, [number, number, number]> = {
  opacity: [0, 1, 0.01],
  roughness: [0, 1, 0.01],
  metalness: [0, 1, 0.01],
  intensity: [0, 3, 0.01],
  density: [0, 0.2, 0.001],
  alphaTest: [0, 1, 0.01],
  envMapIntensity: [0, 4, 0.05],
  emissiveIntensity: [0, 2, 0.01],
  lightMapIntensity: [0, 2, 0.01],
  fov: [20, 100, 1],
  weight: [0, 8, 1],
  count: [0, 60, 1],
  segments: [3, 64, 1],
  widthSegments: [3, 64, 1],
  heightSegments: [3, 64, 1],
  spineStations: [6, 64, 1],
  ringSegments: [4, 40, 1],
  maxHalfWidth: [0.02, 0.8, 0.005],
  widthFalloff: [0.2, 2, 0.05],
  crossSectionExponent: [1.2, 6, 0.05],
  waveMultiplier: [0, 4, 0.05],
  skinPxPerUnit: [1, 6, 0.5],
  skinSupersample: [1, 3, 1],
  radius: [0, 2, 0.005],
  gradientExponent: [0.1, 3, 0.05],
  exponent: [0.2, 6, 0.05],
  threshold: [0, 1, 0.01],
  normalizer: [0.05, 2, 0.01],
  groundY: [-5, 2, 0.05],
};

const sidebarColors = COLOR_DEFS.map((d) => ({ id: d.id, name: d.name }));

function html(clientJs: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Molly tank designer</title>
<style>
  :root { color-scheme: dark; --bg:#0a1620; --panel:#10222f; --line:#1d3a4d;
          --text:#e8f4ff; --dim:#8fb3cc; --accent:#37b6ff; }
  * { box-sizing: border-box; }
  body { margin:0; height:100vh; display:flex; font:13px/1.45 -apple-system,"Segoe UI",sans-serif;
         background:var(--bg); color:var(--text); overflow:hidden; }
  #nav { width:170px; flex:none; background:var(--panel); border-right:1px solid var(--line);
         overflow-y:auto; padding:8px 0; }
  #nav button { display:block; width:100%; text-align:left; padding:7px 14px; background:none;
                border:0; color:var(--dim); cursor:pointer; font:inherit; }
  #nav button:hover { background:#16304180; color:var(--text); }
  #nav button.on { background:#16394f; color:var(--text); box-shadow:inset 3px 0 var(--accent); }
  #nav .changed::after { content:"•"; color:var(--accent); margin-left:5px; }
  #stage { flex:1; display:flex; flex-direction:column; min-width:0; }
  #bar { flex:none; display:flex; gap:8px; align-items:center; padding:8px 12px;
         background:var(--panel); border-bottom:1px solid var(--line); flex-wrap:wrap; }
  #bar label { color:var(--dim); }
  canvas { flex:1; display:block; width:100%; min-height:0; }
  #hud { position:absolute; right:352px; bottom:10px; padding:4px 8px; border-radius:5px;
         background:#00000090; color:var(--dim); font:11px ui-monospace,monospace; }
  #panel { width:340px; flex:none; background:var(--panel); border-left:1px solid var(--line);
           overflow-y:auto; padding:10px 12px 40px; }
  h2 { font-size:13px; margin:2px 0 10px; color:var(--accent); text-transform:uppercase;
       letter-spacing:.06em; }
  h3 { font-size:12px; margin:16px 0 6px; color:var(--dim); border-bottom:1px solid var(--line);
       padding-bottom:3px; }
  .row { display:flex; align-items:center; gap:6px; margin:3px 0; }
  .row > span { flex:1; color:var(--dim); font-size:11.5px; overflow:hidden;
                text-overflow:ellipsis; white-space:nowrap; }
  .row input[type=range] { flex:1.3; min-width:0; accent-color:var(--accent); }
  .row input[type=number] { width:66px; background:#0a1a24; color:var(--text);
                            border:1px solid var(--line); border-radius:4px; padding:2px 4px; }
  .row input[type=color] { width:30px; height:22px; padding:0; border:1px solid var(--line);
                           background:none; border-radius:4px; }
  .row input[type=text] { width:76px; background:#0a1a24; color:var(--text);
                          border:1px solid var(--line); border-radius:4px; padding:2px 4px;
                          font:11px ui-monospace,monospace; }
  button.act { background:#16394f; color:var(--text); border:1px solid var(--line);
               border-radius:6px; padding:5px 11px; cursor:pointer; font:inherit; }
  button.act:hover { border-color:var(--accent); }
  button.act.primary { background:var(--accent); color:#052030; font-weight:600; border-color:transparent; }
  #modes { display:inline-flex; }
  #modes button { border-radius:0; margin:0; }
  #modes button:first-child { border-radius:6px 0 0 6px; }
  #modes button:last-child { border-radius:0 6px 6px 0; border-left-width:0; }
  #modes button.on { background:var(--accent); color:#052030; font-weight:600; }
  #bar.fishmode .tankonly { display:none; }
  #speedval { color:var(--dim); font:11px ui-monospace,monospace; min-width:34px; display:inline-block; }
  select, #bar input[type=number] { background:#0a1a24; color:var(--text);
          border:1px solid var(--line); border-radius:4px; padding:3px 6px; font:inherit; }
  #profile { width:100%; height:190px; background:#0a1a24; border:1px solid var(--line);
             border-radius:6px; margin:6px 0; touch-action:none; cursor:crosshair; }
  #parts { display:flex; flex-wrap:wrap; gap:4px; margin:2px 0 4px; }
  #parts button { background:#0a1a24; color:var(--dim); border:1px solid var(--line);
                  border-radius:5px; padding:3px 8px; cursor:pointer; font:11.5px inherit; }
  #parts button:hover { color:var(--text); border-color:var(--accent); }
  #parts button.on { background:var(--accent); color:#052030; border-color:transparent;
                     font-weight:600; }
  .tiprow { display:flex; align-items:center; gap:5px; margin:3px 0; }
  .tiprow > b { flex:none; width:34px; color:var(--dim); font-weight:400; font-size:11px; }
  .tiprow input { width:100%; min-width:0; background:#0a1a24; color:var(--text);
                  border:1px solid var(--line); border-radius:4px; padding:2px 4px; }
  .tiprow button { flex:none; background:#0a1a24; color:var(--dim); border:1px solid var(--line);
                   border-radius:4px; cursor:pointer; width:22px; }
  .hint { color:#54788f; font-size:11px; margin:6px 0 0; }
  #toast { position:fixed; left:50%; bottom:22px; transform:translateX(-50%); padding:8px 16px;
           background:#16394f; border:1px solid var(--accent); border-radius:8px;
           opacity:0; transition:opacity .18s; pointer-events:none; }
  #toast.show { opacity:1; }
</style></head><body>
<nav id="nav"></nav>
<div id="stage">
  <div id="bar">
    <span id="modes">
      <button class="act mode" data-mode="tank">Tank</button>
      <button class="act mode on" data-mode="fish">Fish</button>
    </span>
    <label>Variety <select id="variety"></select></label>
    <label>Tail <select id="tailTrait"></select></label>
    <label>Dorsal <select id="dorsalTrait"></select></label>
    <label class="tankonly">Count <input id="count" type="number" min="1" max="25" value="6" style="width:56px"></label>
    <label class="tankonly">Speed <input id="speed" type="range" min="0" max="1.5" step="0.05" value="0.35" style="width:80px"><span id="speedval">0.35&times;</span></label>
    <label><input id="skin" type="checkbox" checked> Patterns</label>
    <label><input id="paused" type="checkbox"> Pause</label>
    <label title="fish.useGlbModel — assets/models/short_molly.glb instead of the procedural mesh">
      <input id="useGlb" type="checkbox"> Imported model
    </label>
    <button class="act" id="resetview" title="Back to this mode's default viewpoint">Reset view</button>
    <span style="flex:1"></span>
    <button class="act" id="reset">Reset all</button>
    <button class="act" id="copy">Copy JSON</button>
    <button class="act" id="load">Paste JSON</button>
    <button class="act primary" id="save">Save to file</button>
  </div>
  <canvas id="view"></canvas>
  <div id="hud">—</div>
</div>
<aside id="panel"></aside>
<div id="toast"></div>
<script>${clientJs}</script>
<script>
const DEFAULTS = ${JSON.stringify(DEFAULT_TANK_DESIGN)};
const COLORS = ${JSON.stringify(sidebarColors)};
const HINTS = ${JSON.stringify(RANGE_HINTS)};

const clone = (o) => JSON.parse(JSON.stringify(o));
let design = clone(DEFAULTS);

// Which design subtree each nav section maps to, and whether editing it needs
// a geometry rebuild or can just mutate materials in place.
const SECTIONS = [
  { id: "fish.shape",     label: "Fish shape",    rebuild: true  },
  { id: "fish.material",  label: "Fish material", rebuild: false },
  { id: "fish.motion",    label: "Fish motion",   rebuild: false },
  { id: "fish.dead",      label: "Dead fish",     rebuild: true  },
  { id: "scene.camera",   label: "Camera",        rebuild: true  },
  { id: "scene.lights",   label: "Lighting",      rebuild: false },
  { id: "scene.framing",  label: "Framing",       rebuild: true  },
  { id: "water.backdrop", label: "Backdrop",      rebuild: true  },
  { id: "water.sand",     label: "Sand",          rebuild: true  },
  { id: "water.caustics", label: "Caustics",      rebuild: true  },
  { id: "water.particles",label: "Particles",     rebuild: true  },
  { id: "decor.leaf",     label: "Leaf shape",    rebuild: true  },
  { id: "decor.species",  label: "Plant species", rebuild: true  },
  { id: "decor.plants",   label: "Plants",        rebuild: true  },
  { id: "decor.bubbles",  label: "Bubbles",       rebuild: true  },
  { id: "decor.rocks",    label: "Rocks",         rebuild: true  },
  { id: "decor.driftwood",label: "Driftwood",     rebuild: true  },
  { id: "__root",         label: "Misc",          rebuild: true  },
];
let active = SECTIONS[0].id;

const get = (path) => path.split(".").reduce((o, k) => o?.[k], design);
const getDefault = (path) => path.split(".").reduce((o, k) => o?.[k], DEFAULTS);

function isColor(v) { return typeof v === "string" && /^#[0-9a-f]{3,8}$/i.test(v); }

// Snap to the control's step so dragging a slider can't inject float noise
// like 0.30000000000000004 into the saved file. The serializer is exact by
// design, so this is the only place precision gets cleaned up.
function snap(value, step) {
  if (!Number.isFinite(step) || step <= 0) return value;
  const decimals = (String(step).split(".")[1] || "").length;
  return Number((Math.round(value / step) * step).toFixed(decimals));
}

/** Drag coordinates come out of pixel maths; three decimals is plenty here. */
const round3 = (n) => Math.round(n * 1000) / 1000;

// Dragging a fish part is fiddly enough that losing a good shape to one bad
// drag is genuinely costly — so shape edits are undoable. Snapshots are whole
// designs; at ~150 values that's cheap, and it means undo can't miss a field.
const undoStack = [];
function pushUndo() {
  undoStack.push(JSON.stringify(design));
  if (undoStack.length > 60) undoStack.shift();
}
window.addEventListener("keydown", (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
  const prev = undoStack.pop();
  if (!prev) return;
  e.preventDefault();
  design = JSON.parse(prev);
  renderNav(); renderPanel(); studio.rebuild();
});

function rangeFor(key, value) {
  if (HINTS[key]) return HINTS[key];
  const a = Math.abs(value);
  if (a === 0) return [-1, 1, 0.01];
  if (a < 0.01) return [0, a * 4, a / 50];
  if (a <= 1) return [Math.min(0, value * 2), a * 3, 0.005];
  if (a <= 20) return [Math.min(0, value * 2), a * 3, 0.05];
  return [0, a * 3, 1];
}

let rebuildTimer = null;
function changed(needsRebuild) {
  renderNav();
  if (needsRebuild) {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => studio.rebuild(), 130);
  } else {
    studio.refreshLive();
  }
}

// --- control factories -----------------------------------------------------

function numberRow(label, obj, key, needsRebuild) {
  const [min, max, step] = rangeFor(key, obj[key]);
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = '<span title="' + label + '">' + label + "</span>";
  const slider = document.createElement("input");
  slider.type = "range"; slider.min = min; slider.max = max; slider.step = step;
  slider.value = obj[key];
  const box = document.createElement("input");
  box.type = "number"; box.step = step; box.value = obj[key];
  const set = (v) => {
    const raw = Number(v);
    if (!Number.isFinite(raw)) return;
    const n = snap(raw, step);
    obj[key] = n; slider.value = n; box.value = n; changed(needsRebuild);
  };
  slider.addEventListener("input", () => set(slider.value));
  box.addEventListener("change", () => set(box.value));
  row.append(slider, box);
  return row;
}

function colorRow(label, obj, key, needsRebuild) {
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = '<span title="' + label + '">' + label + "</span>";
  const pick = document.createElement("input");
  pick.type = "color"; pick.value = obj[key];
  const text = document.createElement("input");
  text.type = "text"; text.value = obj[key];
  const set = (v) => { obj[key] = v; pick.value = v; text.value = v; changed(needsRebuild); };
  pick.addEventListener("input", () => set(pick.value));
  text.addEventListener("change", () => { if (isColor(text.value)) set(text.value); });
  row.append(pick, text);
  return row;
}

function boolRow(label, obj, key, needsRebuild) {
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = '<span>' + label + "</span>";
  const cb = document.createElement("input");
  cb.type = "checkbox"; cb.checked = !!obj[key];
  cb.addEventListener("change", () => { obj[key] = cb.checked; changed(needsRebuild); });
  row.append(cb);
  return row;
}

function tupleRow(label, arr, needsRebuild) {
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = '<span title="' + label + '">' + label + "</span>";
  arr.forEach((v, i) => {
    const box = document.createElement("input");
    box.type = "number"; box.step = 0.01; box.value = v; box.style.width = "58px";
    box.addEventListener("change", () => {
      const n = Number(box.value);
      if (Number.isFinite(n)) { arr[i] = n; changed(needsRebuild); }
    });
    row.append(box);
  });
  return row;
}

/** Recursively emit controls for any plain object of scalars/tuples. */
function emit(into, obj, needsRebuild, prefix) {
  for (const [k, v] of Object.entries(obj)) {
    const label = prefix ? prefix + "." + k : k;
    if (typeof v === "number") into.append(numberRow(label, obj, k, needsRebuild));
    else if (isColor(v)) into.append(colorRow(label, obj, k, needsRebuild));
    else if (typeof v === "boolean") into.append(boolRow(label, obj, k, needsRebuild));
    else if (typeof v === "string") { /* ids etc — not editable */ }
    else if (Array.isArray(v) && v.every((x) => typeof x === "number")) {
      into.append(tupleRow(label, v, needsRebuild));
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (typeof item === "number") return;
        const h = document.createElement("h3");
        h.textContent = label + "[" + i + "]" + (item && item.id ? " — " + item.id : "");
        into.append(h);
        if (Array.isArray(item)) into.append(tupleRow(String(i), item, needsRebuild));
        else emit(into, item, needsRebuild, "");
      });
    } else if (v && typeof v === "object") {
      const h = document.createElement("h3");
      h.textContent = label;
      into.append(h);
      emit(into, v, needsRebuild, "");
    }
  }
}

// --- per-part fish shape editor --------------------------------------------
//
// One side view (mesh Z across, mesh Y up, flipped for SVG's y-down space) in
// which every part of the fish is directly draggable. Only one part is live at
// a time, chosen by the tab strip — otherwise handles from five fins and six
// landmarks sit on top of each other and nothing is grabbable.
//
// The silhouette is sampled from fish-mesh-3d's OWN curve function, not
// redrawn here, so the outline can't disagree with the mesh that gets built.

const PARTS = [
  { id: "body",     label: "Body"     },
  { id: "tail",     label: "Tail"     },
  { id: "dorsal",   label: "Dorsal"   },
  { id: "pelvic",   label: "Pelvic"   },
  { id: "anal",     label: "Anal"     },
  { id: "pectoral", label: "Pectoral" },
  { id: "eye",      label: "Eye"      },
];
// Order matters only for the tab strip; every id but "body"/"eye" is a fin key.
const LANDMARK_KEYS = ["nose", "backPeak", "bellyLow", "peduncleTop", "peduncleBottom", "tailBase"];
let activePart = "body";
// Which fin variant the Tail/Dorsal tabs edit — driven by the same top-bar
// selects that pick which variant the preview fish render, so "what you're
// looking at" and "what you're dragging" never disagree.
let editorTail = "round";
let editorDorsal = "standard";

// Resolve activePart to the FinDesign it should read/write right now.
function finConfigFor(shape, part) {
  if (part === "tail") return shape.fins.tail[editorTail];
  if (part === "dorsal") return shape.fins.dorsal[editorDorsal];
  return shape.fins[part];
}

// Wide enough for the tail membrane, which reaches well past the body's +1.
const VIEW = { x: -1.35, y: -1.0, w: 3.45, h: 2.0 };

/**
 * Keep a dragged landmark between its neighbours along the spine. Without
 * this the curves can be dragged inside-out, which the monotone interpolation
 * would then happily sweep into a self-intersecting body.
 */
function clampLandmarkZ(key, z) {
  const lm = design.fish.shape.landmarks;
  const gap = 0.05;
  switch (key) {
    case "nose":           return Math.min(z, Math.min(lm.backPeak.z, lm.bellyLow.z) - gap);
    case "tailBase":       return Math.max(z, Math.max(lm.peduncleTop.z, lm.peduncleBottom.z) + gap);
    case "backPeak":       return Math.min(Math.max(z, lm.nose.z + gap), lm.peduncleTop.z - gap);
    case "bellyLow":       return Math.min(Math.max(z, lm.nose.z + gap), lm.peduncleBottom.z - gap);
    case "peduncleTop":    return Math.min(Math.max(z, lm.backPeak.z + gap), lm.tailBase.z - gap);
    case "peduncleBottom": return Math.min(Math.max(z, lm.bellyLow.z + gap), lm.tailBase.z - gap);
    default:               return z;
  }
}

function shapeEditor(needsRebuild) {
  const shape = design.fish.shape;
  const wrap = document.createElement("div");

  const tabs = document.createElement("div");
  tabs.id = "parts";
  wrap.append(tabs);

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.id = "profile";
  svg.setAttribute("viewBox", VIEW.x + " " + VIEW.y + " " + VIEW.w + " " + VIEW.h);
  wrap.append(svg);

  const tip = document.createElement("p");
  tip.className = "hint";
  wrap.append(tip);

  const fields = document.createElement("div");
  wrap.append(fields);

  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  // SVG y grows downward; mesh y grows up.
  const poly = (pts) => pts.map(([z, y]) => z + "," + -y).join(" ");

  function finPolyline(cfg) {
    const [px, py, pz] = cfg.pivot;
    const pts = [[pz, py], ...cfg.tips.map(([, ty, tz]) => [pz + tz, py + ty]), [pz, py]];
    return { pts, px };
  }

  function draw() {
    const outline = window.__studio.sampleBodyOutline(shape, 90);
    const lm = shape.landmarks;
    let s =
      '<line x1="' + VIEW.x + '" y1="0" x2="' + (VIEW.x + VIEW.w) + '" y2="0" ' +
      'stroke="#1d3a4d" stroke-width="0.006"/>' +
      '<polygon points="' + poly(outline.top) + " " + poly([...outline.bottom].reverse()) + '" ' +
      'fill="#37b6ff14" stroke="#37b6ff" stroke-width="0.012"/>';

    // Every fin is drawn, but only the active one is grabbable — context
    // matters when you're placing an anal fin against the belly line. Tail
    // and dorsal draw whichever variant the top-bar selects currently name.
    const finEntries = [
      ["tail", shape.fins.tail[editorTail]],
      ["dorsal", shape.fins.dorsal[editorDorsal]],
      ["pelvic", shape.fins.pelvic],
      ["anal", shape.fins.anal],
      ["pectoral", shape.fins.pectoral],
    ];
    for (const [key, cfg] of finEntries) {
      const on = key === activePart;
      const { pts } = finPolyline(cfg);
      s += '<polyline points="' + poly(pts) + '" fill="' + (on ? "#ffd18a22" : "#ffffff0a") +
           '" stroke="' + (on ? "#ffd18a" : "#4a708a") + '" stroke-width="0.01"/>';
    }

    const eye = shape.eye;
    s += '<circle cx="' + eye.z + '" cy="' + -eye.y + '" r="' + eye.radius +
         '" fill="#0a1620" stroke="' + (activePart === "eye" ? "#ffd18a" : "#4a708a") +
         '" stroke-width="0.008"/>';

    const handle = (id, z, y, label, color) =>
      '<g data-h="' + esc(id) + '" style="cursor:grab">' +
      '<circle cx="' + z + '" cy="' + -y + '" r="0.038" fill="' + color +
      '" stroke="#0a1620" stroke-width="0.01"/>' +
      '<text x="' + (z + 0.055) + '" y="' + (-y - 0.045) + '" fill="#8fb3cc" ' +
      'font-size="0.075" style="pointer-events:none">' + esc(label) + "</text></g>";

    if (activePart === "body") {
      for (const k of LANDMARK_KEYS) s += handle("lm:" + k, lm[k].z, lm[k].y, k, "#e8f4ff");
    } else if (activePart === "eye") {
      s += handle("eye", eye.z, eye.y, "eye", "#ffd18a");
    } else {
      const cfg = finConfigFor(shape, activePart);
      const [, py, pz] = cfg.pivot;
      s += handle("pivot", pz, py, "pivot", "#37b6ff");
      cfg.tips.forEach(([, ty, tz], i) => {
        s += handle("tip:" + i, pz + tz, py + ty, "t" + i, "#ffd18a");
      });
    }
    svg.innerHTML = s;
  }

  // --- dragging ---
  let dragging = null;
  svg.addEventListener("pointerdown", (e) => {
    const g = e.target.closest?.("g[data-h]");
    if (!g) return;
    pushUndo();
    dragging = g.dataset.h;
    svg.setPointerCapture(e.pointerId);
  });
  // Via the SVG's own CTM, not the bounding rect: the viewBox letterboxes
  // inside the panel, so a naive rect-relative mapping drifts off the cursor.
  const cursor = svg.createSVGPoint();
  function toMesh(e) {
    cursor.x = e.clientX;
    cursor.y = e.clientY;
    const p = cursor.matrixTransform(svg.getScreenCTM().inverse());
    return { z: round3(p.x), y: round3(-p.y) };
  }

  svg.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const { z, y } = toMesh(e);

    if (dragging.startsWith("lm:")) {
      const key = dragging.slice(3);
      const pt = shape.landmarks[key];
      pt.z = round3(clampLandmarkZ(key, z));
      pt.y = y;
    } else if (dragging === "eye") {
      shape.eye.z = z;
      shape.eye.y = y;
    } else if (dragging === "pivot") {
      // Moving a pivot carries its membrane, because tips are pivot-relative.
      const cfg = finConfigFor(shape, activePart);
      cfg.pivot[1] = y;
      cfg.pivot[2] = z;
    } else if (dragging.startsWith("tip:")) {
      const cfg = finConfigFor(shape, activePart);
      const t = cfg.tips[Number(dragging.slice(4))];
      t[1] = round3(y - cfg.pivot[1]);
      t[2] = round3(z - cfg.pivot[2]);
    }
    draw();
    syncFields();
    changed(needsRebuild);
  });
  const stop = () => { dragging = null; };
  svg.addEventListener("pointerup", stop);
  svg.addEventListener("pointercancel", stop);

  // --- numeric fields for what a side view can't show (lateral X, counts) ---

  function numBox(value, onCommit, step) {
    const el = document.createElement("input");
    el.type = "number";
    el.step = step ?? 0.01;
    el.value = value;
    el.addEventListener("change", () => {
      const n = Number(el.value);
      if (!Number.isFinite(n)) { el.value = value; return; }
      pushUndo();
      onCommit(round3(n));
      draw(); syncFields(); changed(needsRebuild);
    });
    return el;
  }

  function labelled(text, ...nodes) {
    const row = document.createElement("div");
    row.className = "tiprow";
    const b = document.createElement("b");
    b.textContent = text;
    row.append(b, ...nodes);
    return row;
  }

  function syncFields() {
    fields.innerHTML = "";
    if (activePart === "body") {
      tip.textContent =
        "Drag the six named landmarks. Back and belly are independent curves — " +
        "backPeak is the true high point, never overshot.";
      for (const k of ["maxHalfWidth", "widthFalloff", "crossSectionExponent",
                       "spineStations", "ringSegments"]) {
        fields.append(numberRow(k, shape, k, needsRebuild));
      }
      return;
    }
    if (activePart === "eye") {
      tip.textContent = "Drag to place the eye along the head. X is its lateral offset.";
      for (const k of ["radius", "x", "widthSegments", "heightSegments", "roughness"]) {
        fields.append(numberRow(k, shape.eye, k, needsRebuild));
      }
      fields.append(colorRow("color", shape.eye, "color", needsRebuild));
      return;
    }

    const cfg = finConfigFor(shape, activePart);
    const variantNote =
      activePart === "tail"
        ? ' Editing the "' + editorTail + '" tail — change it with the Tail select above.'
        : activePart === "dorsal"
          ? ' Editing the "' + editorDorsal + '" dorsal — change it with the Dorsal select above.'
          : "";
    tip.textContent =
      (cfg.mirrored
        ? "Drag the pivot to move the whole fin, tips to reshape the membrane. Mirrored to both flanks."
        : "Drag the pivot to move the whole fin, tips to reshape the membrane.") + variantNote;

    fields.append(labelled("pivot",
      numBox(cfg.pivot[0], (n) => (cfg.pivot[0] = n)),
      numBox(cfg.pivot[1], (n) => (cfg.pivot[1] = n)),
      numBox(cfg.pivot[2], (n) => (cfg.pivot[2] = n)),
    ));

    cfg.tips.forEach((t, i) => {
      const del = document.createElement("button");
      del.textContent = "×";
      del.title = "Remove this tip";
      // Two tips is the minimum that still spans one triangle.
      del.disabled = cfg.tips.length <= 2;
      del.addEventListener("click", () => {
        pushUndo();
        cfg.tips.splice(i, 1);
        draw(); syncFields(); changed(needsRebuild);
      });
      fields.append(labelled("t" + i,
        numBox(t[0], (n) => (t[0] = n)),
        numBox(t[1], (n) => (t[1] = n)),
        numBox(t[2], (n) => (t[2] = n)),
        del,
      ));
    });

    const add = document.createElement("button");
    add.className = "act";
    add.textContent = "+ tip";
    add.addEventListener("click", () => {
      pushUndo();
      // Insert midway along the trailing edge so the new handle is visible and
      // the membrane doesn't jump.
      const last = cfg.tips[cfg.tips.length - 1];
      const prev = cfg.tips[cfg.tips.length - 2] ?? [0, 0, 0];
      cfg.tips.push([
        round3(last[0] + (last[0] - prev[0]) * 0.5),
        round3(last[1] + (last[1] - prev[1]) * 0.5),
        round3(last[2] + (last[2] - prev[2]) * 0.5),
      ]);
      draw(); syncFields(); changed(needsRebuild);
    });
    fields.append(add);
    fields.append(boolRow("mirrored (both flanks)", cfg, "mirrored", needsRebuild));
  }

  for (const p of PARTS) {
    const b = document.createElement("button");
    b.textContent = p.label;
    if (p.id === activePart) b.className = "on";
    b.addEventListener("click", () => {
      activePart = p.id;
      renderPanel();
    });
    tabs.append(b);
  }

  draw();
  syncFields();
  return wrap;
}

// --- panels ----------------------------------------------------------------

function renderNav() {
  const nav = document.getElementById("nav");
  nav.innerHTML = "";
  for (const s of SECTIONS) {
    const b = document.createElement("button");
    b.textContent = s.label;
    b.className = (s.id === active ? "on " : "") + (sectionChanged(s.id) ? "changed" : "");
    b.addEventListener("click", () => { active = s.id; renderNav(); renderPanel(); });
    nav.append(b);
  }
}

function sectionChanged(id) {
  if (id === "__root") {
    return design.skinPxPerUnit !== DEFAULTS.skinPxPerUnit ||
           design.skinSupersample !== DEFAULTS.skinSupersample ||
           design.decor.groundY !== DEFAULTS.decor.groundY;
  }
  return JSON.stringify(get(id)) !== JSON.stringify(getDefault(id));
}

function renderPanel() {
  const panel = document.getElementById("panel");
  panel.innerHTML = "";
  const section = SECTIONS.find((s) => s.id === active);
  const h = document.createElement("h2");
  h.textContent = section.label;
  panel.append(h);

  // fish.shape owns its whole panel — the generic emitter would otherwise
  // dump the landmarks and fin tips again as unreadable nested number rows.
  if (active === "fish.shape") {
    if (design.fish.useGlbModel) {
      // The imported model is one fused mesh with no landmarks or separable
      // fins — nothing here to drag. Say so rather than showing an editor
      // that silently does nothing.
      const note = document.createElement("p");
      note.className = "hint";
      note.textContent =
        "Not applicable to the imported model (assets/models/short_molly.glb) — it's a single fused mesh with no landmarks or separable fins to edit. Turn off 'Imported model' in the top bar to edit the procedural body/fin shape.";
      panel.append(note);
      return;
    }
    panel.append(shapeEditor(true));
    const note = document.createElement("p");
    note.className = "hint";
    note.textContent = "Geometry rebuilds as you drag (debounced). Ctrl/Cmd+Z undoes.";
    panel.append(note);
    return;
  }

  if (active === "__root") {
    emit(panel, design, true, "");
    // Only the scalars at the root; the nested objects have their own sections.
    [...panel.querySelectorAll("h3")].forEach((n) => {
      let el = n.nextElementSibling;
      n.remove();
      while (el && el.tagName !== "H3") { const next = el.nextElementSibling; el.remove(); el = next; }
    });
    const groundRow = numberRow("decor.groundY", design.decor, "groundY", true);
    panel.append(groundRow);
  } else {
    emit(panel, get(active), section.rebuild, "");
  }

  const note = document.createElement("p");
  note.className = "hint";
  note.textContent = section.rebuild
    ? "Changes here rebuild geometry (debounced)."
    : "Changes here apply instantly.";
  panel.append(note);
}

// --- boot ------------------------------------------------------------------

const variety = document.getElementById("variety");
variety.innerHTML = '<option value="">All varieties</option>' +
  COLORS.map((c) => '<option value="' + c.id + '">' + c.name + "</option>").join("");

const TAIL_OPTIONS = [["round", "Round"], ["lyretail", "Lyretail"]];
const DORSAL_OPTIONS = [["standard", "Standard"], ["sailfin", "Sailfin"]];

const tailSelect = document.getElementById("tailTrait");
tailSelect.innerHTML = '<option value="">Vary</option>' +
  TAIL_OPTIONS.map(([id, name]) => '<option value="' + id + '">' + name + "</option>").join("");
tailSelect.value = editorTail;

const dorsalSelect = document.getElementById("dorsalTrait");
dorsalSelect.innerHTML = '<option value="">Vary</option>' +
  DORSAL_OPTIONS.map(([id, name]) => '<option value="' + id + '">' + name + "</option>").join("");
dorsalSelect.value = editorDorsal;

// Fish mode by default: the shape panel is the landing section, and a fish
// crossing a full tank is impossible to edit part-by-part.
const studio = window.__studio.mountTankStudio(
  document.getElementById("view"),
  () => design,
  {
    mode: "fish",
    colorId: null,
    tail: editorTail,
    dorsal: editorDorsal,
    fishCount: 6,
    paused: false,
    showSkin: true,
    speed: 0.35,
  },
);
document.getElementById("bar").classList.add("fishmode");

document.querySelectorAll("#modes button").forEach((b) => {
  b.addEventListener("click", () => {
    const mode = b.dataset.mode;
    document.querySelectorAll("#modes button").forEach((o) => o.classList.toggle("on", o === b));
    document.getElementById("bar").classList.toggle("fishmode", mode === "fish");
    studio.setOptions({ mode });
    studio.rebuild();
  });
});

document.getElementById("resetview").addEventListener("click", () => studio.resetCamera());

const speed = document.getElementById("speed");
speed.addEventListener("input", () => {
  const v = Number(speed.value);
  document.getElementById("speedval").textContent = v.toFixed(2) + "\\u00d7";
  studio.setOptions({ speed: v });
});

setInterval(() => {
  const s = studio.stats();
  document.getElementById("hud").textContent =
    s.calls + " draws · " + s.triangles.toLocaleString() + " tris · " + s.programs + " programs";
}, 500);

variety.addEventListener("change", () => {
  studio.setOptions({ colorId: variety.value || null });
  studio.rebuild();
});
// The shape editor always needs a concrete variant to edit, even when the
// preview is set to "Vary" — so it keeps whichever was last explicitly
// chosen instead of going null along with the preview.
tailSelect.addEventListener("change", () => {
  if (tailSelect.value) editorTail = tailSelect.value;
  studio.setOptions({ tail: tailSelect.value || null });
  studio.rebuild();
  if (active === "fish.shape") renderPanel();
});
dorsalSelect.addEventListener("change", () => {
  if (dorsalSelect.value) editorDorsal = dorsalSelect.value;
  studio.setOptions({ dorsal: dorsalSelect.value || null });
  studio.rebuild();
  if (active === "fish.shape") renderPanel();
});
document.getElementById("count").addEventListener("change", (e) => {
  studio.setOptions({ fishCount: Math.max(1, Number(e.target.value) || 1) });
  studio.rebuild();
});
document.getElementById("skin").addEventListener("change", (e) => {
  studio.setOptions({ showSkin: e.target.checked });
  studio.rebuild();
});
document.getElementById("paused").addEventListener("change", (e) => {
  studio.setOptions({ paused: e.target.checked });
});
const useGlbCheckbox = document.getElementById("useGlb");
useGlbCheckbox.checked = design.fish.useGlbModel;
useGlbCheckbox.addEventListener("change", (e) => {
  design.fish.useGlbModel = e.target.checked;
  if (active === "fish.shape") renderPanel(); // toggles the landmark/fin editor vs the not-applicable note
  changed(true);
});

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 1800);
}

document.getElementById("reset").addEventListener("click", () => {
  if (!confirm("Discard all changes and return to the shipped design?")) return;
  design = clone(DEFAULTS);
  useGlbCheckbox.checked = design.fish.useGlbModel;
  window.__studio.clearSkinCache();
  renderNav(); renderPanel(); studio.rebuild();
});

document.getElementById("copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(JSON.stringify(design, null, 2));
    toast("Design JSON copied");
  } catch { toast("Clipboard blocked — use Save instead"); }
});

document.getElementById("load").addEventListener("click", () => {
  const raw = prompt("Paste a design JSON:");
  if (!raw) return;
  try {
    const next = JSON.parse(raw);
    if (!next.fish || !next.scene) throw new Error("Not a tank design");
    design = next;
    useGlbCheckbox.checked = design.fish.useGlbModel;
    window.__studio.clearSkinCache();
    renderNav(); renderPanel(); studio.rebuild();
    toast("Design loaded");
  } catch (err) { alert("Could not load: " + err.message); }
});

document.getElementById("save").addEventListener("click", async () => {
  const res = await fetch("/api/save", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(design),
  });
  const body = await res.json();
  if (res.ok) toast("Saved — now run: npx prettier --write + yarn verify:3d");
  else alert("Save failed: " + body.error);
});

renderNav();
renderPanel();
</script>
</body></html>`;
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/") {
    try {
      const page = html(buildClient());
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(page);
    } catch (err) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(`Bundle failed:\n\n${(err as Error).message}`);
    }
    return;
  }

  if (req.method === "GET" && req.url === "/short_molly.glb") {
    try {
      const bytes = readFileSync(join(root, "assets/models/short_molly.glb"));
      res.writeHead(200, { "content-type": "model/gltf-binary" });
      res.end(bytes);
    } catch (err) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end(`short_molly.glb not found: ${(err as Error).message}`);
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/save") {
    try {
      const design = (await readJson(req)) as Parameters<typeof serializeDesign>[1];
      const current = readFileSync(DESIGN_PATH, "utf8");
      writeFileSync(DESIGN_PATH, serializeDesign(current, design));
      console.log("Saved tank-design.ts");
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
  console.log(`Tank designer: http://127.0.0.1:${PORT}`);
  console.log("Save writes src/shared/components/tank/tank-design.ts directly.");
});
