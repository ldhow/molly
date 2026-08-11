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
 * not which end/face is which. Determined empirically, not assumed: rendered
 * short_molly.glb wearing the `goldDust` variety (whose whole identity is a
 * black head washing back into gold, so its own texture answers "which end
 * is the nose" directly) and checked which side the dark head landed on. It
 * was the mesh's +length side, so `zSign: -1` maps that to −Z, matching this
 * rig's nose-at−Z convention. `xSign: -1` keeps `(thickness, height, length)`
 * a right-handed basis once mapped onto this rig's own right-handed
 * (X, Y, Z) — two sign flips, not one, so it's still a proper rotation
 * rather than a mirror.
 */
const GLB_ORIENTATION = { xSign: -1, ySign: 1, zSign: -1 } as const;

function remapGlbAxes(pos: THREE.Vector3, axes: PcaAxes): THREE.Vector3 {
  const d = pos.clone().sub(axes.mean);
  return new THREE.Vector3(
    GLB_ORIENTATION.xSign * d.dot(axes.thickness),
    GLB_ORIENTATION.ySign * d.dot(axes.height),
    GLB_ORIENTATION.zSign * d.dot(axes.length),
  );
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
 *   source unwrap. Fins/spikes get whatever the flank texture happens to
 *   show at their (u, v) — reasonable-looking, not membrane-accurate the way
 *   the procedural fins' own vertex-coloured gradient is.
 * - **No modeled trait shapes.** balloon/lyretail/sailfin don't exist here;
 *   the model is one fixed shape regardless of `FishTraits`.
 */
export function createGlbFishMesh(
  palette: FishPalette,
  { skin = null, design = DEFAULT_TANK_DESIGN, bytes }: GlbFishMeshOptions,
): FishMesh3D {
  const parsed = readGlbMeshGeometry(bytes);
  const vertexCount = parsed.position.length / 3;
  const axes = pcaAxes(parsed.position);

  const remapped = new Float32Array(parsed.position.length);
  const scratchPos = new THREE.Vector3();
  for (let i = 0; i < vertexCount; i++) {
    scratchPos.set(parsed.position[i * 3], parsed.position[i * 3 + 1], parsed.position[i * 3 + 2]);
    const v = remapGlbAxes(scratchPos, axes);
    remapped[i * 3] = v.x;
    remapped[i * 3 + 1] = v.y;
    remapped[i * 3 + 2] = v.z;
  }

  let minZ = Infinity;
  let maxZ = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < remapped.length; i += 3) {
    minZ = Math.min(minZ, remapped[i + 2]);
    maxZ = Math.max(maxZ, remapped[i + 2]);
    minY = Math.min(minY, remapped[i + 1]);
    maxY = Math.max(maxY, remapped[i + 1]);
  }
  const spanZ = Math.max(1e-6, maxZ - minZ);

  // Normalize length to MESH_LENGTH so `fish-3d.tsx`'s worldScale maths
  // (which assumes a nose-to-tail length of MESH_LENGTH at scale 1) holds
  // for this mesh exactly as it does for the procedural body — no special
  // casing needed at the call sites.
  const lengthScale = MESH_LENGTH / spanZ;
  const basePositions = new Float32Array(remapped.length);
  for (let i = 0; i < remapped.length; i++) basePositions[i] = remapped[i] * lengthScale;
  const scaledMinZ = minZ * lengthScale;
  const scaledMaxZ = maxZ * lengthScale;
  const scaledMinY = minY * lengthScale;
  const scaledMaxY = maxY * lengthScale;
  const scaledSpanZ = scaledMaxZ - scaledMinZ;
  const scaledSpanY = scaledMaxY - scaledMinY;

  const bodyGeo = new THREE.BufferGeometry();
  bodyGeo.setAttribute("position", new THREE.Float32BufferAttribute(basePositions.slice(), 3));
  bodyGeo.setIndex(new THREE.Uint32BufferAttribute(parsed.index, 1));

  // Back→mid→belly vertex colours, same construction as createFishMesh()'s
  // body — the fallback shown before a skin bake completes, or if none loads.
  const colors = new Float32Array(basePositions.length);
  const backColor = new THREE.Color(palette.back);
  const midColor = new THREE.Color(palette.mid);
  const bellyColor = new THREE.Color(palette.belly);
  const scratch = new THREE.Color();
  for (let i = 0; i < basePositions.length; i += 3) {
    const t = THREE.MathUtils.clamp((basePositions[i + 1] - scaledMinY) / scaledSpanY, 0, 1);
    const c =
      t < 0.5
        ? scratch.copy(bellyColor).lerp(midColor, t * 2)
        : scratch.copy(midColor).lerp(backColor, (t - 0.5) * 2);
    colors[i] = c.r;
    colors[i + 1] = c.g;
    colors[i + 2] = c.b;
  }
  bodyGeo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));

  // Replace the source model's own (unusable, 77-island) UVs with the same
  // planar side-projection createFishMesh() authors for its body, so this
  // mesh can wear the same skin texture despite the broken original unwrap.
  {
    // Clamped, not just divided: min/max were measured from `remapped`
    // (float64) but `basePositions` is stored as float32, so the vertex AT
    // the measured extreme can round to a hair outside it (~1e-9) — clamp
    // catches that instead of feeding a slightly negative/over-1 UV forward.
    const uv = new Float32Array((basePositions.length / 3) * 2);
    for (let i = 0, j = 0; i < basePositions.length; i += 3, j += 2) {
      uv[j] = THREE.MathUtils.clamp((basePositions[i + 2] - scaledMinZ) / scaledSpanZ, 0, 1);
      uv[j + 1] = THREE.MathUtils.clamp((scaledMaxY - basePositions[i + 1]) / scaledSpanY, 0, 1);
    }
    bodyGeo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  }

  bodyGeo.computeVertexNormals();

  const bodyMat = new THREE.MeshStandardMaterial({
    map: skin,
    vertexColors: !skin,
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
    bodyMat.vertexColors = !texture;
    bodyMat.needsUpdate = true;
  }

  return { group, update, setSkin, dispose: () => disposeTree(group) };
}
