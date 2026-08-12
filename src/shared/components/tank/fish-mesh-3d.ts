// The 3D fish's procedural mesh — pure three.js, no React/R3F imports, so it
// stays usable both from the in-app R3F wrapper (fish-3d.tsx) and the
// browser preview tool (scripts/fish-3d-demo.ts). This is the single source
// of truth for the mesh; don't fork it.
//
// The silhouette is authored as NAMED LANDMARKS (nose, backPeak, bellyLow,
// peduncleTop, peduncleBottom, tailBase) in tank-design.ts, sharing render-
// spec.ts's vocabulary for the 2D body, and swept into a cross-section here.
// The body itself is still one fixed form — `balloon` is not reflected here
// yet — but `tail`/`dorsal` now render their real 2D trait shape (round vs
// lyretail, standard vs sailfin), each a distinct FinDesign in tank-design.ts
// keyed by trait id.
//
// The COLOUR is fully real: the `skin` option takes an albedo texture
// rasterized from the same IR the 2D fish draws (see fish/raster.ts and
// fish/skin-map.ts), so patterns, shimmer and the back/mid/belly gradient all
// come through — including the varieties like zebra and electricBlue whose
// entire identity lives in pattern shapes rather than their palette.
//
// The one piece NOT reinvented: body undulation reuses the real `waveDy`
// from swim-model.ts. In the 2D/Skia app that function drives a screen-space
// Y offset (a flat approximation, since a baked texture can't be warped in
// depth). Here it drives true per-vertex X displacement along the spine —
// actual lateral undulation, the anatomically correct axis fish swim with,
// which the flat art could only ever fake.
import * as THREE from "three";

import { readGlbMeshGeometry } from "@/shared/fish/glb-geometry";
import type { DorsalId, TailId } from "@/shared/fish/types";
import { parseHex } from "@/shared/lib/color";
import { waveDy } from "@/shared/lib/swim-model";

import {
  DEFAULT_TANK_DESIGN,
  type FinDesign,
  type FishShapeDesign,
  type TankDesign,
} from "./tank-design";
import { disposeTree } from "./three-dispose";

export interface FishPalette {
  back: string;
  mid: string;
  belly: string;
  fin: string;
  finRay: string;
}

export interface FishMesh3D {
  group: THREE.Group;
  /** Call once per frame with the current swim state's beat/speed/phase. */
  update(beatPhase: number, speedNorm: number, phase: number): void;
  /** Attach (or clear) the albedo map after construction. */
  setSkin(texture: THREE.Texture | null): void;
  /** Release every geometry/material this mesh owns. */
  dispose(): void;
}

/** Nose-to-tail length of the mesh at scale 1 — the landmarks span -1..+1. */
export const MESH_LENGTH = 2;

/**
 * Nose-to-tail length, in the "screen pixel" units the 2D renderer works in,
 * of a fish drawn at scale 1 — read off render-spec.ts's body geometry
 * (x ≈ -52..70). Lets one `scale` value mean the same physical size in both
 * renderers, and converts pixel-authored motion into mesh units.
 */
export const FISH_PX_LENGTH = 122;

/**
 * `waveDy` is authored in SCREEN PIXELS against a ~122px 2D fish (peak ≈3.7px,
 * about 3% of its length). The mesh is MESH_LENGTH units long, so the pixel
 * amplitude has to be converted or the body deforms by whole body-lengths —
 * this factor is exactly that conversion, and `yarn verify:3d` guards it.
 *
 * `design.fish.motion.waveMultiplier` scales it further. That knob is 3D-only
 * on purpose: `waveDy` itself is shared with the 2D Skia renderer, so editing
 * the wave would silently reshape the 2D fish too.
 */
const WAVE_SCALE = MESH_LENGTH / FISH_PX_LENGTH;

/**
 * Perceptual-luminance grayscale of a palette — used for dead-fish rendering.
 *
 * Works on the sRGB hex bytes rather than a `THREE.Color`: colour management
 * converts a Color's components to LINEAR on construction, and applying
 * sRGB-tuned luma weights to linear values comes out noticeably darker than
 * 2D's `DEAD_GRAYSCALE_MATRIX`. These are that matrix's exact coefficients.
 */
export function desaturatePalette(
  palette: FishPalette,
  design: TankDesign = DEFAULT_TANK_DESIGN,
): FishPalette {
  const d = design.fish.dead;
  const gray = (hex: string) => {
    const rgb = parseHex(hex) ?? [0, 0, 0];
    const l = Math.round(
      Math.min(255, d.lumaR * rgb[0] + d.lumaG * rgb[1] + d.lumaB * rgb[2] + d.lift * 255),
    );
    const h = l.toString(16).padStart(2, "0");
    return `#${h}${h}${h}`;
  };
  return {
    back: gray(palette.back),
    mid: gray(palette.mid),
    belly: gray(palette.belly),
    fin: gray(palette.fin),
    finRay: gray(palette.finRay),
  };
}

// ---------------------------------------------------------------------------
// Per-frame orientation math shared by every 3D fish consumer (the in-app R3F
// wrapper AND the browser preview tool) — pulled out here, not duplicated in
// each, so the two can't drift apart.
// ---------------------------------------------------------------------------

/**
 * `rotation.y = yawFor(theta)` makes the model's forward vector (authored
 * pointing -Z) match the swim model's velocity direction (cos theta, sin
 * theta) mapped onto world (X, Z). Verified against three.js's own
 * quaternion math, not just derived by hand — if the body is ever re-authored
 * facing a different local axis, re-verify before assuming this still holds.
 */
export function yawFor(theta: number, design: TankDesign = DEFAULT_TANK_DESIGN): number {
  return -(theta + design.fish.motion.yawOffset);
}

/** Roll into turns — a real 3D bank, unlike the flat app's screen-space tilt. */
export function bankFor(
  facingRight: boolean,
  turnRate: number,
  design: TankDesign = DEFAULT_TANK_DESIGN,
): number {
  const m = design.fish.motion;
  const dir = facingRight ? 1 : -1;
  return Math.max(-m.bankClamp, Math.min(m.bankClamp, -dir * turnRate * m.bankGain));
}

/** Small vertical bob, independent of the swim model's own state. */
export function bobFor(
  elapsedMs: number,
  phase: number,
  design: TankDesign = DEFAULT_TANK_DESIGN,
): number {
  const m = design.fish.motion;
  return Math.sin(elapsedMs / m.bobPeriodMs + phase) * m.bobAmplitude;
}

/**
 * Monotone cubic (Fritsch–Carlson) through a handful of (z, y) landmarks.
 *
 * Monotone, not Catmull-Rom, for a specific reason: a landmark named
 * `backPeak` has to actually BE the highest point on the back. An ordinary
 * spline overshoots either side of an extremum, so the silhouette would bulge
 * above whatever the editor's handle was dragged to and the name would lie.
 * Fritsch–Carlson flattens the tangent at each turning point instead, which
 * also happens to give the rounded shoulder a fish has.
 */
function monotoneCurve(pts: readonly { z: number; y: number }[]): (z: number) => number {
  const n = pts.length;
  const dz: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const d = pts[i + 1].z - pts[i].z;
    dz.push(d);
    slope.push(d === 0 ? 0 : (pts[i + 1].y - pts[i].y) / d);
  }
  const tangents: number[] = [slope[0]];
  for (let i = 0; i < n - 2; i++) {
    const m = slope[i];
    const mNext = slope[i + 1];
    if (m * mNext <= 0) {
      tangents.push(0);
    } else {
      const common = dz[i] + dz[i + 1];
      tangents.push((3 * common) / ((common + dz[i + 1]) / m + (common + dz[i]) / mNext));
    }
  }
  tangents.push(slope[n - 2]);

  return (z: number) => {
    if (z <= pts[0].z) return pts[0].y;
    if (z >= pts[n - 1].z) return pts[n - 1].y;
    let i = n - 2;
    for (let k = 0; k < n - 1; k++) {
      if (z < pts[k + 1].z) {
        i = k;
        break;
      }
    }
    const h = dz[i];
    const t = (z - pts[i].z) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * pts[i].y +
      (t3 - 2 * t2 + t) * h * tangents[i] +
      (-2 * t3 + 3 * t2) * pts[i + 1].y +
      (t3 - t2) * h * tangents[i + 1]
    );
  };
}

/** Signed `|v|^p` — the superellipse cross-section's shaping term. */
function signedPow(v: number, p: number): number {
  return Math.sign(v) * Math.pow(Math.abs(v), p);
}

/**
 * The body's side silhouette, sampled from the same curves `createFishMesh`
 * sweeps. The design editor draws its outline from this rather than
 * re-implementing the interpolation — a second copy of the maths is exactly
 * how an editor starts lying about what the mesh will look like.
 */
export function sampleBodyOutline(
  shape: FishShapeDesign,
  samples = 80,
): { top: [number, number][]; bottom: [number, number][] } {
  const lm = shape.landmarks;
  const topCurve = monotoneCurve([lm.nose, lm.backPeak, lm.peduncleTop, lm.tailBase]);
  const botCurve = monotoneCurve([lm.nose, lm.bellyLow, lm.peduncleBottom, lm.tailBase]);
  const top: [number, number][] = [];
  const bottom: [number, number][] = [];
  for (let i = 0; i < samples; i++) {
    const z = lm.nose.z + ((lm.tailBase.z - lm.nose.z) * i) / (samples - 1);
    top.push([z, topCurve(z)]);
    bottom.push([z, botCurve(z)]);
  }
  return { top, bottom };
}

/**
 * A flat fan from a local-origin pivot to a scalloped outer edge — the same
 * construction as `pushFin()` in render-spec.ts, just authored directly in 3D
 * instead of as an SVG path. Vertex-coloured `finRay` at the root fading to
 * `fin` at the tips, mirroring the 2D membrane gradient.
 */
function makeFanFin(
  tips: THREE.Vector3[],
  finColor: THREE.Color,
  rayColor: THREE.Color,
  material: TankDesign["fish"]["material"]["fin"],
): THREE.Mesh {
  const positions: number[] = [0, 0, 0];
  for (const t of tips) positions.push(t.x, t.y, t.z);
  const colors: number[] = [rayColor.r, rayColor.g, rayColor.b];
  for (let i = 0; i < tips.length; i++) colors.push(finColor.r, finColor.g, finColor.b);
  const indices: number[] = [];
  // Fan from the pivot (vertex 0) out to each adjacent pair of tips. Vertices
  // are [pivot, ...tips], so the highest valid index is `tips.length` — the
  // last triangle legitimately references it.
  for (let i = 1; i < tips.length; i++) indices.push(0, i, i + 1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    side: material.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
    transparent: true,
    opacity: material.opacity,
    roughness: material.roughness,
  });
  return new THREE.Mesh(geo, mat);
}

export interface FishMeshOptions {
  /**
   * Albedo map for the body — the fish's pigment (pattern, shimmer, base
   * gradient) with no lighting baked in. Omit for a plain palette-gradient
   * body, which is what the tank shows until a fish's bake completes.
   */
  skin?: THREE.Texture | null;
  /** Every shape/material/motion value. Defaults to the shipped design. */
  design?: TankDesign;
  /** Which 2D trait shape to render. Defaults to the plain/common variant. */
  tail?: TailId;
  dorsal?: DorsalId;
}

export function createFishMesh(
  palette: FishPalette,
  {
    skin = null,
    design = DEFAULT_TANK_DESIGN,
    tail: tailTrait = "round",
    dorsal: dorsalTrait = "standard",
  }: FishMeshOptions = {},
): FishMesh3D {
  const shape = design.fish.shape;
  const motion = design.fish.motion;
  const group = new THREE.Group();

  // --- Body -----------------------------------------------------------
  // A cross-section swept along the spine, NOT a lathe. A lathe revolves one
  // radius, so its silhouette is forced to be vertically symmetric — it could
  // never give a molly the deep belly and higher back the 2D art has. Sweeping
  // an independent top and bottom curve is what buys `backPeak` and
  // `bellyLow` the freedom to differ.
  //
  // Nose at -Z, tail at +Z, Y up — matching the yaw formula in `yawFor()`.
  // Re-author the body facing another axis and `yawOffset` has to move too.
  const lm = shape.landmarks;
  const topCurve = monotoneCurve([lm.nose, lm.backPeak, lm.peduncleTop, lm.tailBase]);
  const botCurve = monotoneCurve([lm.nose, lm.bellyLow, lm.peduncleBottom, lm.tailBase]);
  const minZ = lm.nose.z;
  const maxZ = lm.tailBase.z;

  const stations = Math.max(3, Math.round(shape.spineStations));
  const ringSegs = Math.max(3, Math.round(shape.ringSegments));
  // Width tracks height, so the deepest station is also the widest. Measured
  // rather than assumed — the peak can sit anywhere the landmarks put it.
  let maxHalfHeight = 1e-6;
  const halfHeights = new Float64Array(stations);
  const centerYs = new Float64Array(stations);
  for (let s = 0; s < stations; s++) {
    const z = minZ + ((maxZ - minZ) * s) / (stations - 1);
    const top = topCurve(z);
    const bot = botCurve(z);
    halfHeights[s] = Math.max(0, (top - bot) / 2);
    centerYs[s] = (top + bot) / 2;
    maxHalfHeight = Math.max(maxHalfHeight, halfHeights[s]);
  }

  const shapeExp = 2 / Math.max(0.2, shape.crossSectionExponent);
  const positions = new Float32Array(stations * ringSegs * 3);
  for (let s = 0, v = 0; s < stations; s++) {
    const z = minZ + ((maxZ - minZ) * s) / (stations - 1);
    const hh = halfHeights[s];
    const hw = shape.maxHalfWidth * Math.pow(hh / maxHalfHeight, shape.widthFalloff);
    for (let r = 0; r < ringSegs; r++, v += 3) {
      const a = (r / ringSegs) * Math.PI * 2;
      positions[v] = hw * signedPow(Math.cos(a), shapeExp);
      positions[v + 1] = centerYs[s] + hh * signedPow(Math.sin(a), shapeExp);
      positions[v + 2] = z;
    }
  }

  // Ring `r` wraps to 0, so the seam needs no duplicate vertex: the UVs are a
  // planar side projection of (y, z) and therefore identical on both sides of
  // it, unlike a lathe's angular UVs.
  const indices: number[] = [];
  for (let s = 0; s < stations - 1; s++) {
    for (let r = 0; r < ringSegs; r++) {
      const a0 = s * ringSegs + r;
      const a1 = s * ringSegs + ((r + 1) % ringSegs);
      const b0 = a0 + ringSegs;
      const b1 = a1 + ringSegs;
      indices.push(a0, b0, b1, a0, b1, a1);
    }
  }

  const bodyGeo = new THREE.BufferGeometry();
  bodyGeo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  bodyGeo.setIndex(indices);
  const basePositions = Float32Array.from(positions);

  // Back→mid→belly vertex colors from the real palette, keyed on height (Y).
  // Three stops, matching the 2D gradient at render-spec.ts's skin base — a
  // two-stop ramp loses the whole mid-flank tone that most varieties are
  // actually recognised by. Measured from the built geometry, so editing the
  // landmarks keeps the gradient and the UVs aligned to the body's real
  // extent instead of a stale literal.
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 1; i < basePositions.length; i += 3) {
    minY = Math.min(minY, basePositions[i]);
    maxY = Math.max(maxY, basePositions[i]);
  }
  const spanY = Math.max(1e-6, maxY - minY);

  const colors = new Float32Array(basePositions.length);
  const backColor = new THREE.Color(palette.back);
  const midColor = new THREE.Color(palette.mid);
  const bellyColor = new THREE.Color(palette.belly);
  const scratch = new THREE.Color();
  for (let i = 0; i < basePositions.length; i += 3) {
    const y = basePositions[i + 1];
    const t = THREE.MathUtils.clamp((y - minY) / spanY, 0, 1); // belly -> 0, back -> 1
    const c =
      t < 0.5
        ? scratch.copy(bellyColor).lerp(midColor, t * 2)
        : scratch.copy(midColor).lerp(backColor, (t - 0.5) * 2);
    colors[i] = c.r;
    colors[i + 1] = c.g;
    colors[i + 2] = c.b;
  }
  bodyGeo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  bodyGeo.computeVertexNormals();

  // Planar side projection for the skin texture. Always authored, even when
  // no skin is supplied yet — the texture arrives asynchronously (see the bake
  // queue in fish-skin-texture.ts) and would have nothing to sample against
  // if the UVs were conditional.
  //
  // NOT a wrapped-around-the-ring UV. Running `u` around the sweep angle
  // makes world Y vary as -cos(2*pi*u), so a stripe painted at art-y -12
  // would land near the back ridge instead of on the flank. Projecting from
  // world Y and Z instead makes the 3D side view register against the 2D art,
  // and because both flanks share a Y the pattern mirrors across for free.
  {
    const uv = new Float32Array((basePositions.length / 3) * 2);
    // Art space has y down and the nose at -x; mesh space has y up and the
    // nose at -Z. So Z maps straight to the texture's horizontal axis, and Y
    // flips onto the vertical one.
    for (let i = 0, j = 0; i < basePositions.length; i += 3, j += 2) {
      const y = basePositions[i + 1];
      const z = basePositions[i + 2];
      uv[j] = (z - minZ) / (maxZ - minZ);
      uv[j + 1] = THREE.MathUtils.clamp((maxY - y) / spanY, 0, 1);
    }
    bodyGeo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  }

  const bodyMat = new THREE.MeshStandardMaterial({
    // With a skin map the texture carries the colour, so vertex colours would
    // double-darken it; without one they're the fallback body gradient.
    map: skin,
    vertexColors: !skin,
    roughness: design.fish.material.body.roughness,
    metalness: design.fish.material.body.metalness,
  });
  const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
  group.add(bodyMesh);

  // --- Fins -------------------------------------------------------------
  const finColor = new THREE.Color(palette.fin);
  const rayColor = new THREE.Color(palette.finRay);

  const finMat = design.fish.material.fin;

  /**
   * One construction for all five fins. `mirrored` builds the opposite flank
   * from a negated clone sharing the same material — the paired fins
   * (pectoral, pelvic) are the only ones that need it, and doing it here
   * rather than per-fin is what lets the editor add or reshape a fin without
   * any code change.
   *
   * Pivots are absolute mesh coordinates and tips are local to the pivot, so
   * a tip drag in the editor moves the membrane and a pivot drag moves the
   * whole fin — which is the distinction the UI needs to expose.
   */
  interface BuiltFin {
    right: THREE.Mesh;
    left: THREE.Mesh | null;
    pivot: THREE.Vector3;
    /** Position along the spine, 0 at the nose — indexes into the wave. */
    u: number;
  }
  function buildFin(cfg: FinDesign): BuiltFin {
    const right = makeFanFin(
      cfg.tips.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
      finColor,
      rayColor,
      finMat,
    );
    const pivot = new THREE.Vector3(...cfg.pivot);
    right.position.copy(pivot);
    group.add(right);

    let left: THREE.Mesh | null = null;
    if (cfg.mirrored) {
      left = new THREE.Mesh(right.geometry.clone(), right.material);
      left.geometry.scale(-1, 1, 1);
      left.geometry.computeVertexNormals();
      left.position.set(-pivot.x, pivot.y, pivot.z);
      group.add(left);
    }
    return {
      right,
      left,
      pivot,
      u: THREE.MathUtils.clamp((pivot.z - minZ) / (maxZ - minZ), 0, 1),
    };
  }

  const tail = buildFin(shape.fins.tail[tailTrait]);
  const dorsal = buildFin(shape.fins.dorsal[dorsalTrait]);
  const pelvic = buildFin(shape.fins.pelvic);
  const anal = buildFin(shape.fins.anal);
  const pectoral = buildFin(shape.fins.pectoral);
  // Every fin rides the body wave, not just the tail — otherwise a dorsal or
  // anal fin visibly detaches from the flank it is supposed to grow out of.
  const wavedFins = [tail, dorsal, pelvic, anal, pectoral];

  // --- Eyes ---------------------------------------------------------
  const eyeCfg = shape.eye;
  const eyeGeo = new THREE.SphereGeometry(
    eyeCfg.radius,
    eyeCfg.widthSegments,
    eyeCfg.heightSegments,
  );
  const eyeMat = new THREE.MeshStandardMaterial({
    color: eyeCfg.color,
    roughness: eyeCfg.roughness,
  });
  const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
  eyeR.position.set(eyeCfg.x, eyeCfg.y, eyeCfg.z);
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
  eyeL.position.set(-eyeCfg.x, eyeCfg.y, eyeCfg.z);
  group.add(eyeR, eyeL);

  // --- Per-frame update -------------------------------------------------
  // px→units conversion times the 3D-only design gain. The gain is separate
  // because `waveDy` is shared with the 2D renderer and must not be edited.
  const waveGain = WAVE_SCALE * motion.waveMultiplier;

  function update(beatPhase: number, speedNorm: number, phase: number) {
    const pos = bodyGeo.getAttribute("position") as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < arr.length; i += 3) {
      const z = basePositions[i + 2];
      const u = (z - minZ) / (maxZ - minZ);
      arr[i] = basePositions[i] + waveDy(u, beatPhase, speedNorm, phase) * waveGain;
    }
    pos.needsUpdate = true;
    bodyGeo.computeVertexNormals();

    // Slide every fin sideways by the wave at its own station so it stays
    // welded to the flank; the tail then adds its hinge swing on top.
    for (const f of wavedFins) {
      const dx = waveDy(f.u, beatPhase, speedNorm, phase) * waveGain;
      f.right.position.x = f.pivot.x + dx;
      if (f.left) f.left.position.x = -f.pivot.x + dx;
    }

    const tailAmp = motion.tailAmpBase + motion.tailAmpSpeed * speedNorm;
    tail.right.rotation.y =
      tailAmp * Math.sin(beatPhase - motion.tailWaveNumber * tail.u + phase - motion.tailLag);

    // Pectorals scull harder when idle, so speed REDUCES this.
    const pecRot =
      (motion.pectoralBase + motion.pectoralIdleGain * (1 - Math.min(1, speedNorm))) *
      Math.sin(beatPhase * motion.pectoralBeatMultiple + phase + motion.pectoralPhase);
    pectoral.right.rotation.z = pecRot;
    if (pectoral.left) pectoral.left.rotation.z = -pecRot;
    // Pelvics counter-scull at half throw — enough to read as alive without
    // competing with the pectorals for attention.
    pelvic.right.rotation.z = -pecRot * 0.5;
    if (pelvic.left) pelvic.left.rotation.z = pecRot * 0.5;
    // The anal fin trails the body wave like a small second tail.
    anal.right.rotation.y = tailAmp * 0.35 * Math.sin(beatPhase - 2.2 * anal.u + phase);
  }

  /**
   * Swap in the albedo once its bake finishes. Fish mount with the cheap
   * palette gradient so nothing blocks, then upgrade in place.
   */
  function setSkin(texture: THREE.Texture | null) {
    bodyMat.map = texture;
    bodyMat.vertexColors = !texture;
    bodyMat.needsUpdate = true;
  }

  return { group, update, setSkin, dispose: () => disposeTree(group) };
}

// ---------------------------------------------------------------------------
// Imported .glb fish — an alternative to createFishMesh() above, wearing a
// real modeled mesh (assets/models/short_molly.glb) instead of the
// procedural swept body. See tank-design.ts's `fish.useGlbModel` for the
// toggle.
// ---------------------------------------------------------------------------

interface PcaAxes {
  mean: THREE.Vector3;
  /** Largest-variance direction — nose-to-tail. */
  length: THREE.Vector3;
  /** Second-largest — dorsal-to-belly. */
  height: THREE.Vector3;
  /** Smallest-variance direction — the flat cutout plane's own normal. */
  thickness: THREE.Vector3;
}

/**
 * Finds a mesh's own natural axes via PCA on its vertex positions, rather
 * than assuming it was authored axis-aligned. Needed because a source .glb
 * isn't guaranteed to be: short_molly.glb is a flat photo cutout angled to
 * face wherever its Blender scene's reference camera sat, not any world
 * axis — its bounding box has no near-zero dimension on any single axis
 * (roughly 9.7 × 1.7 × 12.6), which is what a naive "longest axis = length"
 * reading would get wrong. The largest-variance direction is nose-to-tail
 * regardless of that authored tilt; the smallest is the plane's thickness.
 *
 * Variance is sign-blind — PCA alone can't say which END is the nose, or
 * which FACE is "up". `GLB_ORIENTATION` below is that one-time-per-model
 * correction, determined empirically by rendering. Deterministic: the power
 * iteration is seeded from a fixed vector, not `Math.random()`, so the same
 * file always resolves to the same axes — verified against the exact
 * vectors this produces before calibrating those signs, not just assumed.
 */
function pcaAxes(positions: Float64Array): PcaAxes {
  const n = positions.length / 3;
  const mean = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    mean.x += positions[i * 3];
    mean.y += positions[i * 3 + 1];
    mean.z += positions[i * 3 + 2];
  }
  mean.multiplyScalar(1 / n);

  // Symmetric 3x3 covariance matrix, as a plain 3x3 array — clearer here
  // than THREE.Matrix3's column-major storage for hand-rolled linear algebra.
  const cov: number[][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const d = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    d.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]).sub(mean);
    const dv = [d.x, d.y, d.z];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) cov[a][b] += dv[a] * dv[b];
  }
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) cov[a][b] /= n;

  const matVec = (m: number[][], v: THREE.Vector3) =>
    new THREE.Vector3(
      m[0][0] * v.x + m[0][1] * v.y + m[0][2] * v.z,
      m[1][0] * v.x + m[1][1] * v.y + m[1][2] * v.z,
      m[2][0] * v.x + m[2][1] * v.y + m[2][2] * v.z,
    );

  function dominantEigenvector(m: number[][]): { vec: THREE.Vector3; val: number } {
    // Fixed seed, not Math.random(): this must resolve to the same axes on
    // every run for the same mesh, since GLB_ORIENTATION's sign corrections
    // are calibrated against one specific run's output.
    let v = new THREE.Vector3(1, 1, 1).normalize();
    for (let i = 0; i < 200; i++) {
      const w = matVec(m, v);
      if (w.length() < 1e-12) break;
      v = w.normalize();
    }
    return { vec: v, val: v.dot(matVec(m, v)) };
  }

  const e1 = dominantEigenvector(cov);
  // Deflate: subtract the found component's contribution, then repeat to
  // find the next-largest, orthogonal to it.
  const deflated1: number[][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const e1v = [e1.vec.x, e1.vec.y, e1.vec.z];
  for (let a = 0; a < 3; a++)
    for (let b = 0; b < 3; b++) deflated1[a][b] = cov[a][b] - e1.val * e1v[a] * e1v[b];
  const e2 = dominantEigenvector(deflated1);

  // The third axis is just whatever completes a right-handed orthonormal
  // basis with the first two — cheaper and more numerically stable than a
  // second deflation for a matrix this small.
  const thickness = e1.vec.clone().cross(e2.vec).normalize();

  return { mean, length: e1.vec, height: e2.vec, thickness };
}

/**
 * Per-model sign correction for `pcaAxes()` — PCA finds the three axes but
 * not which end/face is which, so this can't be derived, only checked
 * against the model. PCA's own e1/e2 eigenvectors also have an ARBITRARY
 * sign per run (power iteration converges to whichever direction, not a
 * canonical one) — so, contrary to what an earlier version of this comment
 * claimed, there is no fixed rule for which xSign/ySign/zSign combination is
 * a proper rotation vs. a mirror; that depends on signs PCA itself picked
 * for this specific file, not just on how many of the three are negative.
 * Parity math on paper is not a substitute for looking at the model.
 *
 * Set with `yarn fish:3d-orient` — it renders the actual mesh (real geometry,
 * real lighting) with live xSign/ySign/zSign toggles next to the raw,
 * unprocessed model, so the correct combination is read off the render
 * directly instead of inferred. Re-run it after any `short_molly.glb`
 * replacement — a model swap can invalidate all three signs, and separately
 * can shift the PCA axes enough that even the SAME sign combination that
 * looked right before no longer does.
 */
export interface GlbOrientation {
  xSign: 1 | -1;
  ySign: 1 | -1;
  zSign: 1 | -1;
}

const GLB_ORIENTATION: GlbOrientation = { xSign: -1, ySign: -1, zSign: -1 };

function remapGlbAxes(
  pos: THREE.Vector3,
  axes: PcaAxes,
  orientation: GlbOrientation,
): THREE.Vector3 {
  const d = pos.clone().sub(axes.mean);
  return new THREE.Vector3(
    orientation.xSign * d.dot(axes.thickness),
    orientation.ySign * d.dot(axes.height),
    orientation.zSign * d.dot(axes.length),
  );
}

export interface RemappedGlbMesh {
  /** Flat [x,y,z,...] positions in the rig's coordinate system, normalized
   *  so nose-to-tail spans exactly MESH_LENGTH. */
  position: Float32Array;
  index: Uint32Array;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

/**
 * Parse + PCA + sign-correct + normalize a .glb's mesh into this rig's
 * coordinate system — the shared first half of `createGlbFishMesh()`,
 * pulled out so `yarn fish:3d-orient` can compute the same bounds (for its
 * anatomical markers) without re-deriving the PCA math a second time.
 */
export function remapGlbMesh(
  bytes: ArrayBuffer,
  orientation: GlbOrientation = GLB_ORIENTATION,
): RemappedGlbMesh {
  const parsed = readGlbMeshGeometry(bytes);
  const vertexCount = parsed.position.length / 3;
  const axes = pcaAxes(parsed.position);

  const remapped = new Float32Array(parsed.position.length);
  const scratchPos = new THREE.Vector3();
  for (let i = 0; i < vertexCount; i++) {
    scratchPos.set(parsed.position[i * 3], parsed.position[i * 3 + 1], parsed.position[i * 3 + 2]);
    const v = remapGlbAxes(scratchPos, axes, orientation);
    remapped[i * 3] = v.x;
    remapped[i * 3 + 1] = v.y;
    remapped[i * 3 + 2] = v.z;
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < remapped.length; i += 3) {
    minX = Math.min(minX, remapped[i]);
    maxX = Math.max(maxX, remapped[i]);
    minY = Math.min(minY, remapped[i + 1]);
    maxY = Math.max(maxY, remapped[i + 1]);
    minZ = Math.min(minZ, remapped[i + 2]);
    maxZ = Math.max(maxZ, remapped[i + 2]);
  }

  // Normalize length to MESH_LENGTH so `fish-3d.tsx`'s worldScale maths
  // (which assumes a nose-to-tail length of MESH_LENGTH at scale 1) holds
  // for this mesh exactly as it does for the procedural body — no special
  // casing needed at the call sites.
  const spanZ = Math.max(1e-6, maxZ - minZ);
  const lengthScale = MESH_LENGTH / spanZ;
  const position = new Float32Array(remapped.length);
  for (let i = 0; i < remapped.length; i++) position[i] = remapped[i] * lengthScale;

  return {
    position,
    index: parsed.index,
    minX: minX * lengthScale,
    maxX: maxX * lengthScale,
    minY: minY * lengthScale,
    maxY: maxY * lengthScale,
    minZ: minZ * lengthScale,
    maxZ: maxZ * lengthScale,
  };
}

/**
 * Anatomical landmarks on the remapped mesh, each a 0..1 fraction of that
 * axis's full (fin-inclusive) bounds from `remapGlbMesh()` — the SAME shape
 * `yarn fish:3d-orient` uses for its draggable markers. Shared so a marker
 * placement in the tool is the exact input `createGlbFishMesh()` uses for
 * fin tinting (see `GlbFinTintOverride`), not a separate guess.
 */
export type GlbMarkerKey = "nose" | "tail" | "dorsal" | "belly" | "right" | "left";
export interface GlbMarkerFrac {
  x: number;
  y: number;
  z: number;
}
export type GlbMarkers = Record<GlbMarkerKey, GlbMarkerFrac>;

export const DEFAULT_GLB_MARKERS: GlbMarkers = {
  nose: { x: 0.5, y: 0.5, z: 0 },
  tail: { x: 0.5, y: 0.5, z: 1 },
  dorsal: { x: 0.5, y: 1, z: 0.5 },
  belly: { x: 0.5, y: 0, z: 0.5 },
  right: { x: 1, y: 0.5, z: 0.25 },
  left: { x: 0, y: 0.5, z: 0.25 },
};

/** Every marker except `nose` — `nose` is a body landmark, not a fin. */
const FIN_MARKER_KEYS: GlbMarkerKey[] = ["tail", "dorsal", "belly", "right", "left"];

function markerWorldPos(
  bounds: Pick<RemappedGlbMesh, "minX" | "maxX" | "minY" | "maxY" | "minZ" | "maxZ">,
  f: GlbMarkerFrac,
): THREE.Vector3 {
  return new THREE.Vector3(
    bounds.minX + f.x * (bounds.maxX - bounds.minX),
    bounds.minY + f.y * (bounds.maxY - bounds.minY),
    bounds.minZ + f.z * (bounds.maxZ - bounds.minZ),
  );
}

/**
 * How strongly `palette.fin` blends into each vertex's colour, based on
 * proximity to the nearest fin marker (tail/dorsal/belly/right/left).
 *
 * There's no vertex-group data identifying which triangles are fin vs body
 * (same limitation `GlbPatternBoundsOverride` works around), so this is a
 * soft radial falloff from a handful of marker points, not a real
 * segmentation — it reads as "colour concentrates toward palette.fin near
 * the fin bases", not a sharp, membrane-accurate boundary.
 */
export interface GlbFinTintOverride {
  /** Falloff radius, in mesh units (same scale as MESH_LENGTH=2) — distance
   *  from a marker at which the tint has faded to nothing. */
  radius: number;
  /** How much `palette.fin` blends in at a marker's exact position, 0..1. */
  strength: number;
}

const DEFAULT_FIN_TINT: GlbFinTintOverride = { radius: 0.35, strength: 0.6 };

function computeFinWeights(
  basePositions: Float32Array,
  vertexCount: number,
  bounds: Pick<RemappedGlbMesh, "minX" | "maxX" | "minY" | "maxY" | "minZ" | "maxZ">,
  markers: GlbMarkers,
  tint: GlbFinTintOverride,
): Float32Array {
  const markerPositions = FIN_MARKER_KEYS.map((key) => markerWorldPos(bounds, markers[key]));
  const weights = new Float32Array(vertexCount);
  const v = new THREE.Vector3();
  for (let i = 0; i < vertexCount; i++) {
    v.set(basePositions[i * 3], basePositions[i * 3 + 1], basePositions[i * 3 + 2]);
    let minDist = Infinity;
    for (const mp of markerPositions) minDist = Math.min(minDist, v.distanceTo(mp));
    weights[i] = THREE.MathUtils.clamp(1 - minDist / tint.radius, 0, 1) * tint.strength;
  }
  return weights;
}

/**
 * How much of each end of the Y (height) and Z (length) range to discard
 * before computing the span used for skin UV / vertex-colour mapping, as a
 * 0..1 fraction of vertex count — NOT of fish-shaping-and-eye-placement's
 * full extent, which stays fin-inclusive (see `remapGlbMesh`'s bounds).
 *
 * Why this exists: `buildSkinMap`'s texture is rasterized to the 2D BODY
 * silhouette's own bounding box (`bodyBox()` in skin-map.ts), which excludes
 * fins entirely. Mapping that texture with UVs spanning the mesh's FULL
 * bounding box — which fin tips inflate past the body's actual edges —
 * stretches the pattern to cover empty margin the fins added, so it lands
 * squeezed and offset on the body itself. Trimming the outlier fin-tip
 * vertices out of the span before computing UVs fixes that: body vertices
 * once again span the pattern's full 0..1 range, and fin vertices (now
 * outside that span) clamp to their nearest edge colour — a flat extension
 * of the adjacent flank, not membrane-accurate but a stretch/offset better
 * than before.
 *
 * There's no vertex-group data in the file to identify fin vertices
 * directly, so this is a percentile trim, not a real segmentation — an
 * approximation, tunable per end because the four protrusions (dorsal,
 * caudal, anal/pelvic) aren't the same size. Defaults are starting guesses;
 * dial them in with `yarn fish:3d-orient`.
 */
export interface GlbPatternBoundsOverride {
  /** Fraction trimmed off the head/nose end of Z. Low by default — the nose
   *  is body, not a fin protrusion. */
  trimNoseZ: number;
  /** Fraction trimmed off the tail end of Z — the caudal fin usually
   *  extends further past the body's true tail than any other protrusion. */
  trimTailZ: number;
  /** Fraction trimmed off the top/dorsal end of Y. */
  trimTopY: number;
  /** Fraction trimmed off the bottom/belly end of Y. */
  trimBottomY: number;
}

const DEFAULT_GLB_PATTERN_BOUNDS: GlbPatternBoundsOverride = {
  trimNoseZ: 0,
  trimTailZ: 0.08,
  trimTopY: 0.05,
  trimBottomY: 0.05,
};

/** Value at the given fraction into a SORTED copy of `values` — used to trim
 *  outliers off one end of a range without needing real vertex-group data. */
function trimmedEdge(values: Float32Array, fraction: number): number {
  const sorted = Float32Array.from(values).sort();
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.round(fraction * (sorted.length - 1))));
  return sorted[idx];
}

export interface GlbEyeOverride {
  /** Fraction of body length from the nose where the eye sits (0 = nose tip). */
  zFrac: number;
  /** How far back from the nose the "head" region — used to measure the
   *  local vertical extent the eye is placed within — reaches, as a
   *  fraction of body length. */
  headFrac: number;
  /** Fraction up the head region's own local vertical extent (0=bottom of
   *  the head slice, 1=top), not the whole-body bounding box — the whole
   *  body's vertical extent is dominated by fin/tail height elsewhere and
   *  would place the eye too high or low on the head. */
  yFrac: number;
  /** Lateral half-offset (left/right eye separation). */
  x: number;
  radius: number;
}

export interface GlbFishMeshOptions {
  /** Albedo map for the body. Omit for a plain palette-gradient body. */
  skin?: THREE.Texture | null;
  /** Every shape/material/motion value. Defaults to the shipped design. */
  design?: TankDesign;
  /** Raw bytes of the .glb file. Resolving that from a bundled asset is
   *  platform-specific (expo-asset in-app, readFileSync in Node tools,
   *  fetch in the browser preview) — deliberately the caller's job, so this
   *  module stays free of any one platform's asset APIs. */
  bytes: ArrayBuffer;
  /** Overrides GLB_ORIENTATION's sign correction — for the calibration tool
   *  (`yarn fish:3d-orient`) only; the shipped app never passes this. */
  orientation?: GlbOrientation;
  /** Overrides the eye placement heuristic below — for the calibration tool
   *  only; the shipped app never passes this. */
  eye?: Partial<GlbEyeOverride>;
  /** Overrides the fin-trim heuristic used to compute the skin UV / vertex-
   *  colour span — for the calibration tool only; the shipped app never
   *  passes this. See `GlbPatternBoundsOverride`. */
  patternBounds?: Partial<GlbPatternBoundsOverride>;
  /** Overrides where the fin-tint markers sit — for the calibration tool
   *  only; the shipped app never passes this. See `GlbMarkers`. */
  markers?: Partial<GlbMarkers>;
  /** Overrides the fin-tint falloff — for the calibration tool only; the
   *  shipped app never passes this. See `GlbFinTintOverride`. */
  finTint?: Partial<GlbFinTintOverride>;
}

/**
 * Builds a fish from an imported single-mesh model instead of the swept
 * landmark body. Trade-offs accepted going in, not discovered after:
 *
 * - **One fused mesh, no separable fins.** The source model bakes body, tail,
 *   dorsal spikes and pectorals into one surface with no bones or vertex
 *   groups, so there's nothing to independently rotate — only whole-body
 *   `waveDy` undulation applies. No tail-beat swing, no pectoral scull.
 * - **The model's own UVs are never used, good or not.** The whole point of
 *   this renderer is 16+ player-unlockable colour/pattern varieties — no
 *   single baked-in photo texture (however well the source model's own
 *   unwrap happens to fit it) can stand in for that. So this REPLACES the
 *   parsed UV attribute with the same planar projection `createFishMesh()`
 *   uses for its own body (u from length position, v from height), which is
 *   compatible with our skin texture by construction regardless of the
 *   source unwrap. The span that projection is measured against excludes
 *   fin-tip outliers (see `GlbPatternBoundsOverride`) so the pattern lands
 *   on the body at the right scale instead of being stretched to also cover
 *   the fins; fin vertices themselves still have no separate UV space of
 *   their own, so they inherit whatever the flank shows nearby, MULTIPLIED
 *   by a `palette.fin` tint that strengthens near the fin markers (see
 *   `GlbFinTintOverride`) — a tinted extension of the flank, not
 *   membrane-accurate the way the procedural fins' own flat-coloured
 *   membranes are.
 * - **No modeled trait shapes.** balloon/lyretail/sailfin don't exist here;
 *   the model is one fixed shape regardless of `FishTraits`.
 */
export function createGlbFishMesh(
  palette: FishPalette,
  {
    skin = null,
    design = DEFAULT_TANK_DESIGN,
    bytes,
    orientation = GLB_ORIENTATION,
    eye,
    patternBounds,
    markers,
    finTint,
  }: GlbFishMeshOptions,
): FishMesh3D {
  const {
    position: basePositions,
    index,
    minX: scaledMinX,
    maxX: scaledMaxX,
    minY: scaledMinY,
    maxY: scaledMaxY,
    minZ: scaledMinZ,
    maxZ: scaledMaxZ,
  } = remapGlbMesh(bytes, orientation);
  const scaledSpanZ = scaledMaxZ - scaledMinZ;
  const vertexCount = basePositions.length / 3;

  const bodyGeo = new THREE.BufferGeometry();
  bodyGeo.setAttribute("position", new THREE.Float32BufferAttribute(basePositions.slice(), 3));
  bodyGeo.setIndex(new THREE.Uint32BufferAttribute(index, 1));

  // The span used for skin UV / vertex-colour mapping below — narrower than
  // the mesh's full (fin-inclusive) bounds above, see GlbPatternBoundsOverride.
  const trim: GlbPatternBoundsOverride = { ...DEFAULT_GLB_PATTERN_BOUNDS, ...patternBounds };
  const yValues = new Float32Array(vertexCount);
  const zValues = new Float32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    yValues[i] = basePositions[i * 3 + 1];
    zValues[i] = basePositions[i * 3 + 2];
  }
  const patternMinY = trimmedEdge(yValues, trim.trimBottomY);
  const patternMaxY = trimmedEdge(yValues, 1 - trim.trimTopY);
  const patternMinZ = trimmedEdge(zValues, trim.trimNoseZ);
  const patternMaxZ = trimmedEdge(zValues, 1 - trim.trimTailZ);
  const patternSpanY = Math.max(1e-6, patternMaxY - patternMinY);
  const patternSpanZ = Math.max(1e-6, patternMaxZ - patternMinZ);

  // How strongly each vertex tints toward palette.fin, from proximity to the
  // fin markers — see GlbFinTintOverride. Independent of skin/no-skin: it's
  // baked into buildVertexColors() below either way (see that function).
  const finWeights = computeFinWeights(
    basePositions,
    vertexCount,
    {
      minX: scaledMinX,
      maxX: scaledMaxX,
      minY: scaledMinY,
      maxY: scaledMaxY,
      minZ: scaledMinZ,
      maxZ: scaledMaxZ,
    },
    { ...DEFAULT_GLB_MARKERS, ...markers },
    { ...DEFAULT_FIN_TINT, ...finTint },
  );

  // Replace the source model's own (unusable, 77-island) UVs with the same
  // planar side-projection createFishMesh() authors for its body, so this
  // mesh can wear the same skin texture despite the broken original unwrap.
  {
    // Clamped, not just divided: fin-tip vertices fall outside the trimmed
    // pattern span by construction (that's the point), and body vertices
    // measured from `remapped` (float64) but stored as float32 can round to
    // a hair outside it (~1e-9) — clamp handles both the same way.
    const uv = new Float32Array((basePositions.length / 3) * 2);
    for (let i = 0, j = 0; i < basePositions.length; i += 3, j += 2) {
      uv[j] = THREE.MathUtils.clamp((basePositions[i + 2] - patternMinZ) / patternSpanZ, 0, 1);
      uv[j + 1] = THREE.MathUtils.clamp((patternMaxY - basePositions[i + 1]) / patternSpanY, 0, 1);
    }
    bodyGeo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  }

  bodyGeo.computeVertexNormals();

  // The `color` attribute doubles as two different things depending on
  // whether a skin texture is active, since MeshStandardMaterial can only
  // multiply ONE vertex-colour layer against `map`:
  //  - no skin yet: back→mid→belly gradient (same construction as
  //    createFishMesh()'s body) tinted toward palette.fin near the fin
  //    markers — the fallback shown before a bake completes, or if none loads.
  //  - skin active: white tinted toward palette.fin, so multiplying against
  //    the texture leaves body pixels (weight 0) exactly as textured and
  //    only tints pixels near a fin marker.
  const finColor = new THREE.Color(palette.fin);
  const backColor = new THREE.Color(palette.back);
  const midColor = new THREE.Color(palette.mid);
  const bellyColor = new THREE.Color(palette.belly);
  const base = new THREE.Color();
  const scratch = new THREE.Color();
  function buildVertexColors(useGradient: boolean): Float32Array {
    const colors = new Float32Array(basePositions.length);
    for (let i = 0; i < vertexCount; i++) {
      if (useGradient) {
        const t = THREE.MathUtils.clamp(
          (basePositions[i * 3 + 1] - patternMinY) / patternSpanY,
          0,
          1,
        );
        if (t < 0.5) base.copy(bellyColor).lerp(midColor, t * 2);
        else base.copy(midColor).lerp(backColor, (t - 0.5) * 2);
      } else {
        base.setRGB(1, 1, 1);
      }
      scratch.copy(base).lerp(finColor, finWeights[i]);
      colors[i * 3] = scratch.r;
      colors[i * 3 + 1] = scratch.g;
      colors[i * 3 + 2] = scratch.b;
    }
    return colors;
  }
  bodyGeo.setAttribute("color", new THREE.Float32BufferAttribute(buildVertexColors(!skin), 3));

  const bodyMat = new THREE.MeshStandardMaterial({
    map: skin,
    // Always on now — the color attribute carries fin-tint even once a skin
    // texture is active (white where untinted, a no-op multiply), not just
    // the pre-bake fallback gradient.
    vertexColors: true,
    roughness: design.fish.material.body.roughness,
    metalness: design.fish.material.body.metalness,
    // Unlike the procedural body (a closed volume with a real far side), the
    // source model is a thin cutout plane — nearly single-layer geometry, not
    // a shape with a genuine opposite face. FrontSide culls whichever way
    // isn't currently facing the camera, and since the fish yaws freely to
    // face any swim direction, that means it would appear to vanish or show
    // garbled backfaces for half of every turn. DoubleSide is the correct
    // choice for a flat cutout, not a workaround.
    side: THREE.DoubleSide,
  });
  const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);

  const group = new THREE.Group();
  group.add(bodyMesh);

  // The source model has no baked-in eye (see the class doc above) — add
  // spheres in the same style as createFishMesh()'s eyes. Positioned from
  // this mesh's own remapped/scaled geometry rather than the procedural
  // body's hardcoded landmark coordinates, since the two aren't guaranteed
  // to share an origin: nose is at scaledMinZ (this rig's convention, see
  // GLB_ORIENTATION), and eye height is taken from the head's own local
  // vertical extent — the whole-body bounding box is dominated by fin/tail
  // height elsewhere and would place the eye too high or low on the head.
  {
    const eyeCfg = design.fish.shape.eye;
    const eyeParams: GlbEyeOverride = {
      zFrac: 0.15,
      headFrac: 0.3,
      yFrac: 0.7,
      x: eyeCfg.x,
      radius: eyeCfg.radius,
      ...eye,
    };
    const headEnd = scaledMinZ + eyeParams.headFrac * scaledSpanZ;
    let headMinY = Infinity;
    let headMaxY = -Infinity;
    for (let i = 0; i < basePositions.length; i += 3) {
      if (basePositions[i + 2] > headEnd) continue;
      const y = basePositions[i + 1];
      headMinY = Math.min(headMinY, y);
      headMaxY = Math.max(headMaxY, y);
    }
    if (!Number.isFinite(headMinY)) {
      headMinY = scaledMinY;
      headMaxY = scaledMaxY;
    }
    const eyeZ = scaledMinZ + eyeParams.zFrac * scaledSpanZ;
    const eyeY = headMinY + eyeParams.yFrac * (headMaxY - headMinY);
    const eyeGeo = new THREE.SphereGeometry(
      eyeParams.radius,
      eyeCfg.widthSegments,
      eyeCfg.heightSegments,
    );
    const eyeMat = new THREE.MeshStandardMaterial({
      color: eyeCfg.color,
      roughness: eyeCfg.roughness,
    });
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
    eyeR.position.set(eyeParams.x, eyeY, eyeZ);
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(-eyeParams.x, eyeY, eyeZ);
    group.add(eyeR, eyeL);
  }

  const waveGain = WAVE_SCALE * design.fish.motion.waveMultiplier;

  function update(beatPhase: number, speedNorm: number, phase: number) {
    const pos = bodyGeo.getAttribute("position") as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < arr.length; i += 3) {
      const u = (basePositions[i + 2] - scaledMinZ) / scaledSpanZ;
      arr[i] = basePositions[i] + waveDy(u, beatPhase, speedNorm, phase) * waveGain;
    }
    pos.needsUpdate = true;
    bodyGeo.computeVertexNormals();
  }

  function setSkin(texture: THREE.Texture | null) {
    bodyMat.map = texture;
    // The color attribute's BASE flips (gradient ↔ white) with skin state —
    // see buildVertexColors() above — so it has to be rebuilt here too, not
    // just the map swapped in.
    bodyGeo.setAttribute("color", new THREE.Float32BufferAttribute(buildVertexColors(!texture), 3));
    bodyMat.needsUpdate = true;
  }

  return { group, update, setSkin, dispose: () => disposeTree(group) };
}
