// The water itself: backdrop, sand, caustics and drifting particulate.
// Pure three.js so the browser preview shows the same scene the device does.
//
// Every tunable lives in tank-design.ts — edit it there (or with
// `yarn tank:design`), not here. Each factory takes an optional design so the
// editor can render variants without mutating the shipped defaults.
import * as THREE from "three";

import { mulberry32 } from "@/shared/lib/rng";

import { DEFAULT_TANK_DESIGN, type TankDesign } from "./tank-design";

// ---------------------------------------------------------------------------
// Procedural textures. No DOM canvas in React Native, so every texture here is
// a hand-filled DataTexture. Colour maps must be tagged sRGB explicitly: these
// materials are built imperatively, which bypasses R3F's automatic tagging.
// ---------------------------------------------------------------------------

function dataTexture(
  size: number,
  fill: (x: number, y: number, out: Uint8Array, i: number) => void,
) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) fill(x, y, data, (y * size + x) * 4);
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/** Cheap value noise — smooth, seeded, and good enough for grain and caustics. */
function makeNoise(seed: number) {
  const rand = mulberry32(seed);
  const SIZE = 64;
  const grid = new Float32Array(SIZE * SIZE);
  for (let i = 0; i < grid.length; i++) grid[i] = rand();
  const at = (x: number, y: number) =>
    grid[(((y % SIZE) + SIZE) % SIZE) * SIZE + (((x % SIZE) + SIZE) % SIZE)];
  return (fx: number, fy: number) => {
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    // Smoothstep the interpolation so the result has no visible grid seams.
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
    return a + (b - a) * sy;
  };
}

/** Warm speckled sand grain. */
export function createSandTexture(design: TankDesign = DEFAULT_TANK_DESIGN): THREE.Texture {
  const t = design.water.sand.texture;
  const n = makeNoise(t.seed);
  const SIZE = t.size;
  return dataTexture(SIZE, (x, y, out, i) => {
    const f = (x / SIZE) * t.baseFrequency;
    const g = (y / SIZE) * t.baseFrequency;
    const fine = n(f * 3, g * 3) * 0.5 + n(f, g) * 0.5;
    const patch = n(f * t.patchFrequency, g * t.patchFrequency);
    const v = t.brightness + fine * t.grainContrast - patch * t.patchDarken;
    out[i] = Math.min(255, t.rgb[0] * v);
    out[i + 1] = Math.min(255, t.rgb[1] * v);
    out[i + 2] = Math.min(255, t.rgb[2] * v);
    out[i + 3] = 255;
  });
}

/**
 * Ridged noise — bright thin veins on black, i.e. the classic caustic web.
 * Used as BOTH emissiveMap and lightMap on the sand, scrolled at different
 * rates, so two layers cross for the shimmer at no extra draw call.
 */
export function createCausticsTexture(design: TankDesign = DEFAULT_TANK_DESIGN): THREE.Texture {
  const c = design.water.caustics;
  const n = makeNoise(c.seed);
  const SIZE = c.size;
  return dataTexture(SIZE, (x, y, out, i) => {
    const f = (x / SIZE) * c.cellFrequency;
    const g = (y / SIZE) * c.cellFrequency;
    const ridged = 1 - Math.abs(n(f, g) * 2 - 1);
    // Push the falloff hard so only the crests survive as bright filaments.
    const v = Math.pow(Math.max(0, ridged - c.threshold) / c.normalizer, c.exponent);
    const shade = Math.min(255, Math.round(v * 255));
    out[i] = shade;
    out[i + 1] = shade;
    out[i + 2] = shade;
    out[i + 3] = 255;
  });
}

/** Soft round dot for the floating particulate. */
function createDotTexture(size: number): THREE.Texture {
  const SIZE = size;
  const tex = dataTexture(SIZE, (x, y, out, i) => {
    const dx = (x / (SIZE - 1)) * 2 - 1;
    const dy = (y / (SIZE - 1)) * 2 - 1;
    const d = Math.hypot(dx, dy);
    const a = Math.max(0, 1 - d);
    out[i] = 255;
    out[i + 1] = 255;
    out[i + 2] = 255;
    out[i + 3] = Math.round(a * a * 255);
  });
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

// ---------------------------------------------------------------------------
// Scene pieces.
// ---------------------------------------------------------------------------

export interface SandFloor {
  mesh: THREE.Mesh;
  /** Scroll the two caustic layers against each other. */
  update(t: number): void;
}

/** Gently duned sand with a grain map and animated caustics. */
export function createSand(
  width: number,
  depth: number,
  design: TankDesign = DEFAULT_TANK_DESIGN,
): SandFloor {
  const s = design.water.sand;
  const c = design.water.caustics;
  const geo = new THREE.PlaneGeometry(width, depth, s.tessellationX, s.tessellationY);
  const n = makeNoise(s.duneSeed);
  const pos = geo.getAttribute("position");
  for (let v = 0; v < pos.count; v++) {
    // Plane is authored in XY then rotated flat, so Z here is height.
    pos.setZ(
      v,
      (n(
        pos.getX(v) * s.duneFrequency + s.duneOffset,
        pos.getY(v) * s.duneFrequency + s.duneOffset,
      ) -
        0.5) *
        s.duneAmplitude,
    );
  }
  geo.computeVertexNormals();

  const caustics = createCausticsTexture(design);
  // A second texture object over the same image data lets the two layers
  // scroll independently — offsets live on the texture, not the material.
  const causticsB = caustics.clone();
  causticsB.needsUpdate = true;
  caustics.repeat.set(c.repeatA[0], c.repeatA[1]);
  causticsB.repeat.set(c.repeatB[0], c.repeatB[1]);

  const sand = createSandTexture(design);
  sand.repeat.set(s.grainRepeat[0], s.grainRepeat[1]);

  const mat = new THREE.MeshStandardMaterial({
    map: sand,
    emissive: new THREE.Color(s.material.emissive),
    emissiveMap: caustics,
    emissiveIntensity: s.material.emissiveIntensity,
    lightMap: causticsB,
    lightMapIntensity: s.material.lightMapIntensity,
    roughness: s.material.roughness,
    envMapIntensity: s.material.envMapIntensity,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = design.decor.groundY;
  // lightMap requires a second UV set; the plane's uv is fine for both.
  geo.setAttribute("uv1", geo.getAttribute("uv"));

  return {
    mesh,
    update(t: number) {
      caustics.offset.set((t * c.scrollA[0]) % 1, (t * c.scrollA[1]) % 1);
      causticsB.offset.set((t * c.scrollB[0]) % 1, (t * c.scrollB[1]) % 1);
    },
  };
}

/**
 * An inverted sphere with a vertical gradient, so fog fades into water rather
 * than into a flat void. A sphere rather than a back wall means no seam at
 * any aspect ratio or camera angle.
 */
export function createBackdrop(design: TankDesign = DEFAULT_TANK_DESIGN): THREE.Mesh {
  const b = design.water.backdrop;
  const geo = new THREE.SphereGeometry(b.radius, b.widthSegments, b.heightSegments);
  const top = new THREE.Color(b.top);
  const bottom = new THREE.Color(b.bottom);
  const pos = geo.getAttribute("position");
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let v = 0; v < pos.count; v++) {
    const t = THREE.MathUtils.clamp(pos.getY(v) / b.radius / 2 + 0.5, 0, 1);
    c.copy(bottom).lerp(top, Math.pow(t, b.gradientExponent));
    colors[v * 3] = c.r;
    colors[v * 3 + 1] = c.g;
    colors[v * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  return new THREE.Mesh(
    geo,
    // Basic, not Standard: this is a backdrop, it should not respond to the
    // tank's lights or it will read as a lit surface rather than distance.
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false }),
  );
}

export interface Particles {
  points: THREE.Points;
  update(t: number, dt: number): void;
}

/**
 * Suspended particulate. One draw call, and more than anything else in the
 * scene it is what makes the volume read as water rather than air.
 */
export function createParticles(
  count: number,
  halfWidth: number,
  halfDepth: number,
  topY: number,
  design: TankDesign = DEFAULT_TANK_DESIGN,
): Particles {
  const p = design.water.particles;
  const groundY = design.decor.groundY;
  const rand = mulberry32(p.seed);
  const positions = new Float32Array(count * 3);
  const drift = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (rand() * 2 - 1) * halfWidth;
    positions[i * 3 + 1] = groundY + rand() * (topY - groundY);
    positions[i * 3 + 2] = (rand() * 2 - 1) * halfDepth;
    drift[i * 2] = p.riseMin + rand() * p.riseVariance; // rise speed
    drift[i * 2 + 1] = rand() * Math.PI * 2; // wobble phase
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));

  const points = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      map: createDotTexture(p.dotSize),
      color: p.color,
      size: p.size,
      sizeAttenuation: true,
      transparent: true,
      opacity: p.opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );

  return {
    points,
    update(t: number, dt: number) {
      const attr = geo.getAttribute("position") as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      for (let i = 0; i < count; i++) {
        arr[i * 3 + 1] += drift[i * 2] * dt * 60 * 0.016;
        if (arr[i * 3 + 1] > topY) arr[i * 3 + 1] = groundY;
        arr[i * 3] += Math.sin(t * p.wobbleRate + drift[i * 2 + 1]) * p.wobbleAmplitude;
      }
      attr.needsUpdate = true;
    },
  };
}
