// Plants, bubbles, rocks and driftwood for the 3D tank — pure three.js (no
// React/R3F), same split as fish-mesh-3d.ts so the browser preview can use it.
//
// The 2D tank draws these in plants.tsx / bubbles.tsx / water-background.tsx;
// this is the 3D counterpart, authored fresh rather than ported, since a
// swaying SVG path and a swaying mesh have nothing in common structurally.
import * as THREE from "three";

import { mulberry32 } from "@/shared/lib/rng";

import { DEFAULT_TANK_DESIGN, type PlantSpeciesDesign, type TankDesign } from "./tank-design";

/**
 * Sand surface height.
 *
 * Kept as a named export because plenty of call sites just want "the floor",
 * but the real source of truth is `design.decor.groundY` — read that when you
 * have a design in hand, so a tuned tank stays internally consistent.
 */
export const GROUND_Y = DEFAULT_TANK_DESIGN.decor.groundY;

export interface DecorPiece {
  group: THREE.Group;
  /** @param t seconds since mount @param dt seconds since last frame */
  update(t: number, dt: number): void;
}

// ---------------------------------------------------------------------------
// Shared leaf texture. A tapered silhouette in the alpha channel is what turns
// a rectangle into something plant-shaped; `alphaTest` (rather than
// `transparent`) keeps it a single opaque draw with no sort-order problems.
// ---------------------------------------------------------------------------

let leafTexture: THREE.Texture | null = null;

/**
 * Drop the cached leaf texture so the next `createPlants` rebuilds it.
 *
 * The cache is shared across every blade in the tank, which is what keeps
 * plants to one texture — but it also means leaf-shape edits appear to do
 * nothing until it's cleared. The design editor calls this whenever a
 * `decor.leaf.*` value changes.
 */
export function resetLeafTexture(): void {
  leafTexture?.dispose();
  leafTexture = null;
}

function getLeafTexture(design: TankDesign): THREE.Texture {
  if (leafTexture) return leafTexture;
  const cfg = design.decor.leaf;
  const W = cfg.width;
  const H = cfg.height;
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    const v = y / (H - 1); // 0 = root, 1 = tip
    // Widest a third of the way up, tapering to a point — a leaf, not a strip.
    const halfWidth =
      Math.sin(Math.pow(v, cfg.widestBias) * Math.PI) * cfg.maxHalfWidth + cfg.minStalkWidth;
    for (let x = 0; x < W; x++) {
      const u = (x / (W - 1)) * 2 - 1; // -1..1 across the blade
      const i = (y * W + x) * 4;
      const inside = Math.abs(u) <= halfWidth;
      // A darker midrib, and slightly lighter toward the edges.
      const rib = 1 - Math.exp(-Math.pow(u / cfg.ribWidth, 2)) * cfg.ribDarkness;
      const shade = Math.round(255 * rib);
      data[i] = shade;
      data[i + 1] = shade;
      data[i + 2] = shade;
      data[i + 3] = inside ? 255 : 0;
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.flipY = false;
  tex.needsUpdate = true;
  leafTexture = tex;
  return tex;
}

// ---------------------------------------------------------------------------
// Species. The table itself lives in tank-design.ts so the editor can tune it;
// this is just the weighted pick.
// ---------------------------------------------------------------------------

function pickSpecies(species: PlantSpeciesDesign[], rand: () => number): PlantSpeciesDesign {
  const total = species.reduce((s, sp) => s + sp.weight, 0);
  let r = rand() * total;
  for (const sp of species) {
    r -= sp.weight;
    if (r <= 0) return sp;
  }
  return species[0];
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Seaweed: leaf-shaped planes whose vertices sway more the further they are
 * from the root — the 3D analogue of the 2D plants' skewX sway.
 */
export function createPlants(
  count: number,
  halfWidth: number,
  halfDepth: number,
  design: TankDesign = DEFAULT_TANK_DESIGN,
): DecorPiece {
  const cfg = design.decor.plants;
  const groundY = design.decor.groundY;
  const rand = mulberry32(cfg.seed);
  const group = new THREE.Group();
  const leaf = getLeafTexture(design);
  const blades: {
    geo: THREE.BufferGeometry;
    base: Float32Array;
    height: number;
    phase: number;
    amp: number;
  }[] = [];

  for (let i = 0; i < count; i++) {
    const species = pickSpecies(design.decor.species, rand);
    const clumpX = (rand() * 2 - 1) * halfWidth * cfg.inset;
    const clumpZ = (rand() * 2 - 1) * halfDepth * cfg.inset;
    const bladeCount = Math.round(lerp(species.bladeCount[0], species.bladeCount[1], rand()));
    const color = new THREE.Color(species.base[Math.floor(rand() * species.base.length)]);
    const tip = new THREE.Color(species.tip);

    for (let b = 0; b < bladeCount; b++) {
      const height = lerp(species.height[0], species.height[1], rand());
      const width = lerp(species.width[0], species.width[1], rand());
      const geo = new THREE.PlaneGeometry(width, height, 1, cfg.segments);
      // PlaneGeometry is centred on the origin; lift it so the root sits on
      // the sand and the blade grows upward from there.
      geo.translate(0, height / 2, 0);

      // Darker at the root, brighter at the tip — cheap depth without a texture.
      const pos = geo.getAttribute("position");
      const colors = new Float32Array(pos.count * 3);
      for (let v = 0; v < pos.count; v++) {
        const t = THREE.MathUtils.clamp(pos.getY(v) / height, 0, 1);
        const c = color.clone().lerp(tip, t * cfg.tipBlend);
        colors[v * 3] = c.r;
        colors[v * 3 + 1] = c.g;
        colors[v * 3 + 2] = c.b;
      }
      geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));

      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({
          vertexColors: true,
          map: leaf,
          // alphaTest, not transparent: keeps the leaf silhouette without
          // paying for blending or hitting depth-sort artefacts between the
          // dozens of overlapping blades in a clump.
          alphaTest: cfg.alphaTest,
          side: THREE.DoubleSide,
          roughness: cfg.roughness,
        }),
      );
      mesh.position.set(
        clumpX + (rand() * 2 - 1) * cfg.jitter,
        groundY,
        clumpZ + (rand() * 2 - 1) * cfg.jitter,
      );
      mesh.rotation.y = rand() * Math.PI;
      // Splay the blades outward so a clump reads as a plant, not a stack.
      mesh.rotation.z = (rand() * 2 - 1) * species.spread;
      group.add(mesh);

      blades.push({
        geo,
        base: Float32Array.from(geo.getAttribute("position").array as ArrayLike<number>),
        height,
        phase: rand() * Math.PI * 2,
        amp: species.swayAmp * lerp(cfg.swayVarianceMin, cfg.swayVarianceMax, rand()),
      });
    }
  }

  function update(t: number) {
    for (const blade of blades) {
      const pos = blade.geo.getAttribute("position") as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      for (let i = 0; i < arr.length; i += 3) {
        const y = blade.base[i + 1];
        // Quadratic falloff pins the root and lets the tip travel.
        const k = (y / blade.height) ** 2;
        arr[i] =
          blade.base[i] +
          Math.sin(t * cfg.swayRateX + blade.phase + y * cfg.swayWaveNumber) * blade.amp * k;
        arr[i + 2] =
          blade.base[i + 2] +
          Math.cos(t * cfg.swayRateZ + blade.phase) * blade.amp * cfg.swayCrossRatio * k;
      }
      pos.needsUpdate = true;
    }
  }

  return { group, update };
}

/** Bubbles drifting up from the sand, wrapping back to the floor at the top. */
export function createBubbles(
  count: number,
  halfWidth: number,
  halfDepth: number,
  topY: number,
  design: TankDesign = DEFAULT_TANK_DESIGN,
): DecorPiece {
  const cfg = design.decor.bubbles;
  const groundY = design.decor.groundY;
  const rand = mulberry32(cfg.seed);
  const group = new THREE.Group();
  const geo = new THREE.SphereGeometry(1, cfg.widthSegments, cfg.heightSegments);
  const mat = new THREE.MeshStandardMaterial({
    color: cfg.color,
    transparent: true,
    opacity: cfg.opacity,
    roughness: cfg.roughness,
    metalness: cfg.metalness,
    envMapIntensity: cfg.envMapIntensity,
  });

  const bubbles: { mesh: THREE.Mesh; speed: number; phase: number; baseX: number }[] = [];
  for (let i = 0; i < count; i++) {
    const mesh = new THREE.Mesh(geo, mat);
    const r = cfg.radiusMin + rand() * cfg.radiusVariance;
    mesh.scale.setScalar(r);
    const x = (rand() * 2 - 1) * halfWidth * cfg.spread;
    mesh.position.set(
      x,
      groundY + rand() * (topY - groundY),
      (rand() * 2 - 1) * halfDepth * cfg.spread,
    );
    group.add(mesh);
    bubbles.push({
      mesh,
      speed: cfg.speedMin + rand() * cfg.speedVariance,
      phase: rand() * Math.PI * 2,
      baseX: x,
    });
  }

  function update(t: number, dt: number) {
    for (const b of bubbles) {
      b.mesh.position.y += b.speed * dt;
      if (b.mesh.position.y > topY) b.mesh.position.y = groundY;
      // Wobble around the column it rose from, rather than drifting away.
      b.mesh.position.x = b.baseX + Math.sin(t * cfg.wobbleRate + b.phase) * cfg.wobbleAmplitude;
    }
  }

  return { group, update };
}

/** A few low-poly stones so the sand isn't a bare plane. Static. */
export function createRocks(
  count: number,
  halfWidth: number,
  halfDepth: number,
  design: TankDesign = DEFAULT_TANK_DESIGN,
): THREE.Group {
  const cfg = design.decor.rocks;
  const groundY = design.decor.groundY;
  const rand = mulberry32(cfg.seed);
  const group = new THREE.Group();
  for (let i = 0; i < count; i++) {
    const big = i < cfg.bigCount;
    // Subdivide the largest so they don't read as dice.
    const geo = new THREE.IcosahedronGeometry(1, big ? 1 : 0);
    // Rough the silhouette up so no two stones are the same shape.
    const pos = geo.getAttribute("position");
    for (let v = 0; v < pos.count; v++) {
      const k = 1 + (rand() - 0.5) * cfg.roughenAmount;
      pos.setXYZ(v, pos.getX(v) * k, pos.getY(v) * k, pos.getZ(v) * k);
    }
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(cfg.colorA).lerp(new THREE.Color(cfg.colorB), rand()),
        roughness: cfg.roughness,
        flatShading: true,
      }),
    );
    const s = (big ? cfg.sizeBig : cfg.sizeSmall) + rand() * cfg.sizeVariance;
    mesh.scale.set(s * (0.8 + rand() * 0.6), s * (0.5 + rand() * 0.4), s * (0.8 + rand() * 0.6));
    mesh.position.set(
      (rand() * 2 - 1) * halfWidth * cfg.spread,
      groundY + s * cfg.sinkFactor,
      (rand() * 2 - 1) * halfDepth * cfg.spread,
    );
    mesh.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI);
    group.add(mesh);
  }
  return group;
}

/**
 * A branching piece of driftwood. More than anything else this is what makes
 * an aquarium read as arranged rather than randomly scattered.
 */
export function createDriftwood(
  halfWidth: number,
  halfDepth: number,
  design: TankDesign = DEFAULT_TANK_DESIGN,
): THREE.Group {
  const cfg = design.decor.driftwood;
  const groundY = design.decor.groundY;
  const rand = mulberry32(cfg.seed);
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: cfg.color,
    roughness: cfg.roughness,
    flatShading: true,
  });

  const rootX = (rand() * 2 - 1) * halfWidth * cfg.rootXFactor;
  const rootZ = -halfDepth * (cfg.rootZMin + rand() * cfg.rootZVariance);

  // A main trunk lying at an angle, plus a couple of branches off it.
  const trunkDir = new THREE.Vector3(
    rand() * 2 - 1,
    cfg.leanMin + rand() * cfg.leanVariance,
    rand() * 2 - 1,
  ).normalize();
  const trunkLen = cfg.trunkLengthMin + rand() * cfg.trunkLengthVariance;
  const trunkPts: THREE.Vector3[] = [];
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    trunkPts.push(
      new THREE.Vector3(
        rootX + trunkDir.x * trunkLen * t + (rand() - 0.5) * cfg.trunkJitter,
        groundY + 0.05 + trunkDir.y * trunkLen * t,
        rootZ + trunkDir.z * trunkLen * t + (rand() - 0.5) * cfg.trunkJitter,
      ),
    );
  }
  const trunk = new THREE.CatmullRomCurve3(trunkPts);
  group.add(
    new THREE.Mesh(
      new THREE.TubeGeometry(
        trunk,
        cfg.trunkSegments,
        cfg.trunkRadius,
        cfg.trunkRadialSegments,
        false,
      ),
      material,
    ),
  );

  for (let b = 0; b < cfg.branchMin + Math.floor(rand() * cfg.branchVariance); b++) {
    const from = trunk.getPoint(0.35 + rand() * 0.5);
    const dir = new THREE.Vector3(rand() * 2 - 1, 0.3 + rand() * 0.6, rand() * 2 - 1).normalize();
    const len = cfg.branchLengthMin + rand() * cfg.branchLengthVariance;
    const pts = [0, 0.5, 1].map(
      (t) =>
        new THREE.Vector3(
          from.x + dir.x * len * t + (rand() - 0.5) * cfg.branchJitter,
          from.y + dir.y * len * t,
          from.z + dir.z * len * t + (rand() - 0.5) * cfg.branchJitter,
        ),
    );
    const branch = new THREE.CatmullRomCurve3(pts);
    group.add(
      new THREE.Mesh(
        new THREE.TubeGeometry(
          branch,
          cfg.branchSegments,
          cfg.branchRadius,
          cfg.branchRadialSegments,
          false,
        ),
        material,
      ),
    );
  }

  return group;
}
