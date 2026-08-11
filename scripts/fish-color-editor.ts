// Interactive tool for tuning fish colors: a tiny local server + browser UI
// that renders each variety (both body types) live from the
// SAME buildFishSpec() the app uses, so what you see is exactly what ships.
// Edits never touch disk — use the "Copy code" button to paste the result
// back into src/shared/fish/catalog.ts, then `yarn fish:preview` to confirm
// in the full gallery (life stages, dead/locked states, etc).
//
// Run: yarn fish:colors   (defaults to http://127.0.0.1:5477, override with PORT=)

import { createServer, type IncomingMessage } from "node:http";

import { COLOR_DEFS, PATTERN_SEED_BUCKETS, standardTraits } from "../src/shared/fish/catalog";
import { RARITY_COLORS, formatRarity } from "../src/shared/fish/rarity";
import type { BodyId, ColorDef } from "../src/shared/fish/types";
import { fishSvg } from "./lib/fish-svg";

const PORT = Number(process.env.PORT) || 5477;
const BODIES: BodyId[] = ["standard", "balloon"];

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

interface RenderRequest {
  def: ColorDef;
  patternSeed?: number;
}

function renderBoth(def: ColorDef, patternSeed: number): Record<BodyId, string> {
  const out = {} as Record<BodyId, string>;
  for (const body of BODIES) {
    const traits = { ...standardTraits(def.id), body, patternSeed };
    out[body] = fishSvg(traits, def, { stage: "adult" });
  }
  return out;
}

const sidebar = COLOR_DEFS.map((def) => ({
  id: def.id,
  order: def.order,
  name: def.name,
  rarityLabel: formatRarity(def.rarity),
  rarityColor: RARITY_COLORS[def.rarity.tier],
}));

const HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Molly fish color editor</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: -apple-system, "Segoe UI", sans-serif; font-size: 13px;
         background: linear-gradient(180deg, #0b3a5c 0%, #063049 45%, #02131f 100%);
         color:#eaf6ff; display:flex; height:100vh; }
  h1 { font-size:15px; margin:0 0 4px; }
  h2 { font-size:12px; margin:14px 0 6px; color:#8fb3cc; text-transform:uppercase; letter-spacing:.04em; }
  aside { width:220px; overflow-y:auto; border-right:1px solid rgba(255,255,255,.1); padding:10px; flex-shrink:0; }
  aside .item { display:flex; align-items:center; gap:8px; padding:6px 8px; border-radius:6px; cursor:pointer; }
  aside .item:hover { background: rgba(255,255,255,.06); }
  aside .item.active { background: rgba(255,255,255,.14); }
  aside .dot { width:10px; height:10px; border-radius:50%; flex-shrink:0; }
  aside .order { color:#54788f; font-size:10px; width:18px; flex-shrink:0; }
  aside .name { flex:1; }
  main { flex:1; overflow-y:auto; padding:18px 24px; }
  .previews { display:flex; gap:24px; margin: 10px 0 18px; }
  .preview { text-align:center; background: rgba(255,255,255,.04); border-radius:10px; padding:10px 16px; }
  .preview .label { color:#8fb3cc; font-size:11px; margin-top:6px; }
  .preview svg { display:block; width:220px; height:auto; }
  #prev-balloon svg { width:340px; }
  #prev-balloon.drawing svg { cursor:crosshair; }
  .shape-list { max-height:160px; overflow-y:auto; margin-top:6px; }
  .shape-row { display:flex; align-items:center; gap:8px; padding:3px 0; }
  .shape-row .swatch { width:14px; height:14px; border-radius:3px; flex-shrink:0; border:1px solid rgba(255,255,255,.3); }
  .shape-row .kind { flex:1; color:#8fb3cc; }
  .shape-row button { padding:2px 8px; }
  .field { display:flex; align-items:center; gap:8px; margin:6px 0; }
  .field label { width:88px; flex-shrink:0; color:#8fb3cc; }
  .field input[type="color"] { width:34px; height:26px; padding:0; border:1px solid rgba(255,255,255,.2); border-radius:4px; background:none; }
  .field input[type="text"] { width:90px; font-family: ui-monospace, Consolas, monospace; background:#0b2436; color:#eaf6ff; border:1px solid rgba(255,255,255,.2); border-radius:4px; padding:3px 6px; }
  .field input[type="number"] { width:64px; font-family: ui-monospace, Consolas, monospace; background:#0b2436; color:#eaf6ff; border:1px solid rgba(255,255,255,.2); border-radius:4px; padding:3px 6px; }
  .field select { background:#0b2436; color:#eaf6ff; border:1px solid rgba(255,255,255,.2); border-radius:4px; padding:3px 6px; }
  .row { display:flex; flex-wrap:wrap; gap:4px 20px; align-items:center; }
  .variants { display:flex; gap:6px; }
  .variants button { min-width:28px; padding:6px 8px; }
  button { font: inherit; background:#123a54; color:#eaf6ff; border:1px solid rgba(255,255,255,.2);
           border-radius:6px; padding:6px 12px; cursor:pointer; }
  button:hover { background:#1c4d6e; }
  button.primary { background:#2f7dd9; border-color:#2f7dd9; }
  button.primary:hover { background:#3d8ce6; }
  .badge { display:inline-block; font-size:10px; font-weight:700; padding:1px 8px; border-radius:99px; border:1px solid; margin-left:6px; }
  .desc { color:#8fb3cc; font-size:12px; max-width:520px; margin: 2px 0 12px; }
  pre { background:#02131f; border:1px solid rgba(255,255,255,.15); border-radius:8px; padding:12px;
        white-space:pre-wrap; font-family: ui-monospace, Consolas, monospace; font-size:12px; max-width:600px; }
  .hint { color:#54788f; font-size:11px; }
</style></head>
<body>
<aside id="sidebar"></aside>
<main>
  <h1 id="title">—</h1>
  <div id="rarity"></div>
  <p class="desc" id="desc"></p>

  <div class="previews">
    <div class="preview"><div id="prev-balloon"></div><div class="label">Balloon — draw here (bigger canvas; Standard follows the same shapes)</div></div>
    <div class="preview"><div id="prev-standard"></div><div class="label">Standard</div></div>
  </div>

  <h2>Pattern variant <span class="hint">— preview of the ${PATTERN_SEED_BUCKETS} per-fish rolls this variety's own settings produce</span></h2>
  <div class="variants" id="variant"></div>

  <h2>Palette</h2>
  <div class="row" id="palette"></div>

  <h2>Accent (UI chips)</h2>
  <div class="row" id="accent"></div>

  <h2>Shimmer</h2>
  <div class="row" id="shimmer"></div>

  <h2>Pattern colors</h2>
  <div class="row" id="pattern"></div>

  <h2>Pattern tuning <span class="hint">— density/scale/randomness multipliers, blank = default (1×)</span></h2>
  <div class="row" id="tuning"></div>

  <div style="margin-top:18px; display:flex; gap:8px;">
    <button id="reset">Reset this variety</button>
    <button class="primary" id="copy">Copy code</button>
  </div>
  <p class="hint">Paste the copied object over the matching entry in <code>src/shared/fish/catalog.ts</code>, then run <code>npx prettier --write src/shared/fish/catalog.ts</code> and <code>yarn fish:preview</code> to confirm. The pattern variant picker above is preview-only — it's not part of the copied object (each fish rolls its own variant from its session id at runtime).</p>
  <pre id="code" style="display:none"></pre>
</main>

<script>
const SIDEBAR = ${JSON.stringify(sidebar)};
const ORIGINAL = ${JSON.stringify(COLOR_DEFS)};
const PATTERN_SEED_BUCKETS = ${PATTERN_SEED_BUCKETS};
let current = null; // working (possibly edited) ColorDef
let selectedId = SIDEBAR[0].id;
let patternSeed = 0; // preview-only — which of this variety's per-fish rolls to render
let renderTimer = null;
let drawTool = "spot"; // "spot" | "stroke" — active hand-drawing tool
let drawSize = 6; // spot radius / stroke width, in fish-local units
let drawColor = "#202020";

function byId(id) { return ORIGINAL.find((d) => d.id === id); }

function cloneDef(def) { return JSON.parse(JSON.stringify(def)); }

function renderSidebar() {
  const el = document.getElementById("sidebar");
  el.innerHTML = SIDEBAR.map((d) => \`
    <div class="item\${d.id === selectedId ? " active" : ""}" data-id="\${d.id}">
      <span class="dot" style="background:\${d.rarityColor}"></span>
      <span class="order">#\${d.order}</span>
      <span class="name">\${d.name}</span>
    </div>\`).join("");
  el.querySelectorAll(".item").forEach((node) => {
    node.addEventListener("click", () => selectVariety(node.dataset.id));
  });
}

function selectVariety(id) {
  selectedId = id;
  current = cloneDef(byId(id));
  patternSeed = 0;
  document.getElementById("code").style.display = "none";
  renderSidebar();
  renderForm();
  renderVariantPicker();
  scheduleRender();
}

function renderVariantPicker() {
  const wrap = document.getElementById("variant");
  wrap.innerHTML = "";
  for (let i = 0; i < PATTERN_SEED_BUCKETS; i++) {
    const b = document.createElement("button");
    b.textContent = String(i + 1);
    b.className = i === patternSeed ? "primary" : "";
    b.title = "Preview per-fish variant " + (i + 1) + " of " + PATTERN_SEED_BUCKETS;
    b.addEventListener("click", () => {
      patternSeed = i;
      renderVariantPicker();
      scheduleRender();
    });
    wrap.appendChild(b);
  }
}

function colorField(label, get, set) {
  const wrap = document.createElement("div");
  wrap.className = "field";
  const l = document.createElement("label");
  l.textContent = label;
  const color = document.createElement("input");
  color.type = "color";
  color.value = get();
  const text = document.createElement("input");
  text.type = "text";
  text.value = get();
  const onChange = (val) => {
    set(val);
    color.value = val;
    text.value = val;
    scheduleRender();
  };
  color.addEventListener("input", () => onChange(color.value));
  text.addEventListener("change", () => onChange(text.value));
  wrap.append(l, color, text);
  return wrap;
}

// Optional numeric multiplier (density/scale/randomness) — blank means
// "unset", which patternPrimitives() reads as its own built-in default (1×),
// and which formatColorDef() below omits entirely from the exported object.
function numberField(label, get, set, opts) {
  const wrap = document.createElement("div");
  wrap.className = "field";
  const l = document.createElement("label");
  l.textContent = label;
  const input = document.createElement("input");
  input.type = "number";
  input.step = String(opts.step ?? 0.1);
  input.min = String(opts.min ?? 0);
  input.max = String(opts.max ?? 3);
  input.placeholder = String(opts.default ?? 1);
  const v = get();
  input.value = v === undefined || v === null ? "" : v;
  input.addEventListener("change", () => {
    set(input.value === "" ? undefined : parseFloat(input.value));
    scheduleRender();
  });
  wrap.append(l, input);
  return wrap;
}

function renderForm() {
  document.getElementById("title").textContent = \`#\${current.order} \${current.name}\`;
  document.getElementById("rarity").innerHTML =
    \`<span class="badge" style="background:\${RARITY_COLOR(current)}22;color:\${RARITY_COLOR(current)};border-color:\${RARITY_COLOR(current)}55">\${RARITY_LABEL(current)}</span>\`;
  document.getElementById("desc").textContent = current.description;

  const pal = document.getElementById("palette");
  pal.innerHTML = "";
  for (const key of ["back", "mid", "belly", "fin", "finRay"]) {
    pal.appendChild(colorField(key, () => current.palette[key], (v) => (current.palette[key] = v)));
  }

  const accent = document.getElementById("accent");
  accent.innerHTML = "";
  accent.appendChild(colorField("accentColor", () => current.accentColor, (v) => (current.accentColor = v)));

  const shimmerWrap = document.getElementById("shimmer");
  shimmerWrap.innerHTML = "";
  const sel = document.createElement("select");
  ["none", "silver", "bluePurple", "iridescent"].forEach((opt) => {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt;
    if ((current.shimmer ?? "none") === opt) o.selected = true;
    sel.appendChild(o);
  });
  sel.addEventListener("change", () => {
    current.shimmer = sel.value === "none" ? undefined : sel.value;
    scheduleRender();
  });
  shimmerWrap.appendChild(sel);

  const patWrap = document.getElementById("pattern");
  patWrap.innerHTML = "";
  const p = current.pattern;
  if (p.type === "custom") {
    patWrap.appendChild(buildDrawToolbar());
    const list = document.createElement("div");
    list.className = "shape-list";
    list.id = "shapes";
    patWrap.appendChild(list);
    renderShapeList();
  } else {
    if (p.type === "solid") {
      patWrap.innerHTML = '<span class="hint">Solid — no pattern color.</span>';
    } else if (p.type === "spots" || p.type === "stripes") {
      patWrap.appendChild(colorField("color", () => p.color, (v) => (p.color = v)));
    } else if (p.type === "speckle") {
      patWrap.appendChild(colorField("color", () => p.color, (v) => (p.color = v)));
      if (p.frontColor !== undefined) {
        patWrap.appendChild(colorField("frontColor", () => p.frontColor, (v) => (p.frontColor = v)));
      }
    } else if (p.type === "patches") {
      p.colors.forEach((_, i) => {
        patWrap.appendChild(colorField("colors[" + i + "]", () => p.colors[i], (v) => (p.colors[i] = v)));
      });
    }
    const convertBtn = document.createElement("button");
    convertBtn.textContent = "Hand-draw this pattern instead";
    convertBtn.style.marginTop = "8px";
    convertBtn.addEventListener("click", convertToCustom);
    patWrap.appendChild(convertBtn);
  }

  const tuneWrap = document.getElementById("tuning");
  tuneWrap.innerHTML = "";
  if (p.type === "solid") {
    tuneWrap.innerHTML = '<span class="hint">Solid has no generated shapes to tune.</span>';
  } else if (p.type === "custom") {
    tuneWrap.innerHTML = '<span class="hint">Hand-drawn shapes have no procedural knobs — edit them on the canvas above.</span>';
  } else {
    tuneWrap.appendChild(
      numberField("density", () => p.density, (v) => (p.density = v), { min: 0.2, max: 3, step: 0.1 }),
    );
    tuneWrap.appendChild(
      numberField("scale", () => p.scale, (v) => (p.scale = v), { min: 0.3, max: 2.5, step: 0.1 }),
    );
    tuneWrap.appendChild(
      numberField("randomness", () => p.randomness, (v) => (p.randomness = v), { min: 0, max: 3, step: 0.1 }),
    );
    if (p.type === "patches") {
      tuneWrap.appendChild(document.createTextNode(""));
      const note = document.createElement("span");
      note.className = "hint";
      note.textContent = "(density has no effect on patches — see render-spec.ts comment)";
      tuneWrap.appendChild(note);
    }
  }
}

function convertToCustom() {
  // Carry over a sensible starting draw color from whatever this variety's
  // procedural pattern was using, before it's overwritten.
  drawColor = current.pattern.color || (current.pattern.colors && current.pattern.colors[0]) || "#202020";
  current.pattern = { type: "custom", shapes: [] };
  renderForm();
  scheduleRender();
}

function buildDrawToolbar() {
  const wrap = document.createElement("div");

  const tools = document.createElement("div");
  tools.className = "row";
  tools.style.marginBottom = "6px";
  const TOOL_LABELS = { spot: "Spot (click)", stroke: "Stroke (drag)", pen: "Pen (tapered drag)" };
  ["spot", "stroke", "pen"].forEach((tool) => {
    const b = document.createElement("button");
    b.textContent = TOOL_LABELS[tool];
    b.className = drawTool === tool ? "primary" : "";
    b.addEventListener("click", () => {
      drawTool = tool;
      buildDrawToolbarInPlace();
    });
    b.dataset.tool = tool;
    tools.appendChild(b);
  });
  wrap.appendChild(tools);

  const sizeField = document.createElement("div");
  sizeField.className = "field";
  const sizeLabel = document.createElement("label");
  sizeLabel.textContent = "size";
  const sizeInput = document.createElement("input");
  sizeInput.type = "number";
  sizeInput.min = "0.5";
  sizeInput.max = "25";
  sizeInput.step = "0.5";
  sizeInput.value = String(drawSize);
  sizeInput.addEventListener("change", () => (drawSize = parseFloat(sizeInput.value) || 1));
  sizeField.append(sizeLabel, sizeInput);
  wrap.appendChild(sizeField);

  const colorField_ = document.createElement("div");
  colorField_.className = "field";
  const colorLabel = document.createElement("label");
  colorLabel.textContent = "color";
  const colorInput = document.createElement("input");
  colorInput.type = "color";
  colorInput.value = drawColor;
  colorInput.addEventListener("input", () => (drawColor = colorInput.value));
  colorField_.append(colorLabel, colorInput);
  wrap.appendChild(colorField_);

  const clearBtn = document.createElement("button");
  clearBtn.textContent = "Clear all shapes";
  clearBtn.addEventListener("click", () => {
    current.pattern.shapes = [];
    renderShapeList();
    scheduleRender();
  });
  wrap.appendChild(clearBtn);

  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = "Click or drag directly on the Balloon preview below to draw.";
  wrap.appendChild(hint);

  return wrap;
}

// Re-render just the toolbar's tool-select buttons' active state, without
// tearing down the rest of the pattern panel (renderForm() would also wipe
// the shape list and any in-progress drawing listeners for no reason).
function buildDrawToolbarInPlace() {
  const patWrap = document.getElementById("pattern");
  const fresh = buildDrawToolbar();
  patWrap.replaceChild(fresh, patWrap.firstChild);
}

function renderShapeList() {
  const wrap = document.getElementById("shapes");
  if (!wrap) return;
  const shapes = current.pattern.shapes || [];
  if (!shapes.length) {
    wrap.innerHTML = '<span class="hint">No shapes yet — draw on the Balloon preview below.</span>';
    return;
  }
  wrap.innerHTML = "";
  const KIND_LABELS = { blob: "spot", stroke: "stroke", ribbon: "pen" };
  shapes.forEach((s, i) => {
    const row = document.createElement("div");
    row.className = "shape-row";
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = s.color;
    const label = document.createElement("span");
    label.className = "kind";
    label.textContent = KIND_LABELS[s.kind] + " #" + (i + 1);
    const del = document.createElement("button");
    del.textContent = "×";
    del.title = "Delete";
    del.addEventListener("click", () => {
      shapes.splice(i, 1);
      renderShapeList();
      scheduleRender();
    });
    row.append(swatch, label, del);
    wrap.appendChild(row);
  });
}

function pathFromPoints(points) {
  return "M " + points.map((pt) => pt[0].toFixed(1) + " " + pt[1].toFixed(1)).join(" L ");
}

// A calligraphy-pen outline: full width through the middle of the stroke,
// tapering to a point over the first/last 15% of its length — the classic
// "tapered stroke" look — built as a closed ribbon polygon since SVG has no
// per-segment variable stroke-width. Perpendiculars come from each point's
// local tangent (its neighbors), not a single stroke-wide direction, so the
// ribbon follows curves instead of just the start/end direction.
function ribbonPath(points, maxWidth) {
  if (points.length < 2) return "";
  const n = points.length;
  const left = [];
  const right = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const taper = Math.max(0, Math.min(1, t / 0.15, (1 - t) / 0.15));
    const halfWidth = (maxWidth / 2) * taper;
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(n - 1, i + 1)];
    let dx = next[0] - prev[0];
    let dy = next[1] - prev[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const px = -dy;
    const py = dx;
    left.push([points[i][0] + px * halfWidth, points[i][1] + py * halfWidth]);
    right.push([points[i][0] - px * halfWidth, points[i][1] - py * halfWidth]);
  }
  return pathFromPoints(left) + " L " + pathFromPoints(right.slice().reverse()).slice(2) + " Z";
}

// Wires pointer events directly onto the just-rendered <svg> inside
// #prev-balloon (the bigger of the two bodies — easier to draw on precisely,
// and its shapes render on Standard too automatically) so drawing happens on
// the real, live fish art rather than a separately-positioned overlay that
// could drift out of alignment. Must be re-attached after every doRender(),
// since innerHTML replaces the element.
function attachDrawing() {
  const container = document.getElementById("prev-balloon");
  const svg = container.querySelector("svg");
  if (!svg || current.pattern.type !== "custom") return;
  container.classList.add("drawing");

  function toLocal(evt) {
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }

  let dragging = false;
  let points = [];
  let liveEl = null;

  svg.addEventListener("pointerdown", (evt) => {
    const p = toLocal(evt);
    if (drawTool === "spot") {
      current.pattern.shapes.push({
        kind: "blob",
        cx: Math.round(p.x * 10) / 10,
        cy: Math.round(p.y * 10) / 10,
        rx: drawSize,
        ry: drawSize,
        color: drawColor,
      });
      renderShapeList();
      scheduleRender();
      return;
    }
    dragging = true;
    points = [[p.x, p.y]];
    liveEl = document.createElementNS("http://www.w3.org/2000/svg", "path");
    if (drawTool === "pen") {
      liveEl.setAttribute("fill", drawColor);
      liveEl.setAttribute("stroke", "none");
    } else {
      liveEl.setAttribute("fill", "none");
      liveEl.setAttribute("stroke", drawColor);
      liveEl.setAttribute("stroke-width", String(drawSize));
      liveEl.setAttribute("stroke-linecap", "round");
      liveEl.setAttribute("stroke-linejoin", "round");
    }
    svg.appendChild(liveEl);
    svg.setPointerCapture(evt.pointerId);
  });

  svg.addEventListener("pointermove", (evt) => {
    if (!dragging) return;
    const p = toLocal(evt);
    points.push([p.x, p.y]);
    liveEl.setAttribute("d", drawTool === "pen" ? ribbonPath(points, drawSize) : pathFromPoints(points));
  });

  svg.addEventListener("pointerup", () => {
    if (!dragging) return;
    dragging = false;
    if (points.length > 1) {
      if (drawTool === "pen") {
        current.pattern.shapes.push({ kind: "ribbon", d: ribbonPath(points, drawSize), color: drawColor });
      } else {
        current.pattern.shapes.push({
          kind: "stroke",
          d: pathFromPoints(points),
          color: drawColor,
          width: drawSize,
        });
      }
      renderShapeList();
      scheduleRender();
    }
    if (liveEl) liveEl.remove();
    liveEl = null;
    points = [];
  });
}

function RARITY_COLOR(def) {
  return SIDEBAR.find((d) => d.id === def.id).rarityColor;
}
function RARITY_LABEL(def) {
  return SIDEBAR.find((d) => d.id === def.id).rarityLabel;
}

function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(doRender, 60);
}

async function doRender() {
  const res = await fetch("/api/render", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ def: current, patternSeed }),
  });
  const { svgs } = await res.json();
  document.getElementById("prev-standard").innerHTML = svgs.standard;
  const balloonContainer = document.getElementById("prev-balloon");
  balloonContainer.classList.remove("drawing");
  balloonContainer.innerHTML = svgs.balloon;
  if (current.pattern.type === "custom") attachDrawing();
}

function jsVal(v) {
  if (Array.isArray(v)) return "[" + v.map((x) => jsVal(x)).join(", ") + "]";
  if (v && typeof v === "object") return inlineObj(v);
  return JSON.stringify(v);
}
function inlineObj(obj) {
  // Filter out undefined-valued entries (e.g. a tuning field typed then
  // cleared back to blank) so the exported object only ever lists the knobs
  // someone actually customized, matching catalog.ts's existing style.
  return (
    "{ " +
    Object.entries(obj)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => k + ": " + jsVal(v))
      .join(", ") +
    " }"
  );
}
function formatColorDef(def) {
  const lines = ["{"];
  lines.push('  id: ' + JSON.stringify(def.id) + ',');
  lines.push('  order: ' + def.order + ',');
  lines.push('  name: ' + JSON.stringify(def.name) + ',');
  lines.push('  description: ' + JSON.stringify(def.description) + ',');
  lines.push('  rarity: ' + inlineObj(def.rarity) + ',');
  lines.push('  accentColor: ' + JSON.stringify(def.accentColor) + ',');
  lines.push('  palette: {');
  for (const k of ["back", "mid", "belly", "fin", "finRay"]) {
    lines.push('    ' + k + ': ' + JSON.stringify(def.palette[k]) + ',');
  }
  lines.push('  },');
  lines.push('  pattern: ' + inlineObj(def.pattern) + ',');
  if (def.shimmer) lines.push('  shimmer: ' + JSON.stringify(def.shimmer) + ',');
  lines.push('  unlock: ' + inlineObj(def.unlock) + ',');
  lines.push('},');
  return lines.join("\\n");
}

document.getElementById("reset").addEventListener("click", () => selectVariety(selectedId));
document.getElementById("copy").addEventListener("click", async () => {
  const code = formatColorDef(current);
  const pre = document.getElementById("code");
  pre.textContent = code;
  pre.style.display = "block";
  try {
    await navigator.clipboard.writeText(code);
  } catch (e) {
    // clipboard permission denied — the <pre> above is still there to select manually
  }
});

renderSidebar();
selectVariety(selectedId);
</script>
</body></html>`;

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(HTML);
    return;
  }

  if (req.method === "POST" && req.url === "/api/render") {
    readJson(req)
      .then((body) => {
        const { def, patternSeed } = body as RenderRequest;
        const svgs = renderBoth(def, patternSeed ?? 0);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ svgs }));
      })
      .catch((err: Error) => {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      });
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Fish color editor: http://127.0.0.1:${PORT}`);
});
