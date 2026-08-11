// Scene setup + swim loop for the 3D fish demo. Bundled by fish-3d-demo.ts.
//
// Reuses swim-model.ts (stepSwim/initSwimState) unchanged — the demo's tank
// bounding box is authored directly in world units, so state.x/state.y map
// straight onto world X/Z with no rescaling. This also means turns and depth
// are REAL 3D here: an actual camera-relative rotation and an actual Z
// position, not the perspective-transform/scale-and-fade approximations the
// flat Skia app needed (see fish-sprite.tsx's liveTransform and
// tank-canvas.tsx's depth sort for what those approximations look like).
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import {
  bankFor,
  bobFor,
  createFishMesh,
  createGlbFishMesh,
  yawFor,
  type FishMesh3D,
  type FishPalette,
} from "../../src/shared/components/tank/fish-mesh-3d";
import { DEFAULT_TANK_DESIGN, type TankDesign } from "../../src/shared/components/tank/tank-design";
import {
  createBubbles,
  createDriftwood,
  createPlants,
  createRocks,
} from "../../src/shared/components/tank/tank-decor-3d";
import {
  createBackdrop,
  createParticles,
  createSand,
} from "../../src/shared/components/tank/tank-env-3d";
import { getColorDef } from "../../src/shared/fish/catalog";
import { buildSkinMap } from "../../src/shared/fish/skin-map";
import type { FishTraits } from "../../src/shared/fish/types";
import { seedFromString } from "../../src/shared/lib/seed";
import {
  initSwimState,
  stepSwim,
  type SwimState,
  type WanderBox,
} from "../../src/shared/lib/swim-model";

export interface DemoFishSpec {
  id: string;
  palette: FishPalette;
  traits: FishTraits;
}

/**
 * Same albedo the app uploads, built by the same rasterizer — the whole point
 * of this preview is that what you see here is what the device renders.
 */
function skinTexture(traits: FishTraits): THREE.Texture {
  const map = buildSkinMap(traits, getColorDef(traits.color));
  const tex = new THREE.DataTexture(
    new Uint8Array(map.data.buffer, map.data.byteOffset, map.data.length),
    map.width,
    map.height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

const TANK_HALF_WIDTH = 6;
const TANK_HALF_DEPTH = 4;

interface TrackedFish {
  fish3d: FishMesh3D;
  state: SwimState;
  phase: number;
}

export function mountTankDemo(
  canvas: HTMLCanvasElement,
  specs: DemoFishSpec[],
  design: TankDesign = DEFAULT_TANK_DESIGN,
  /** Pre-decoded bytes of assets/models/short_molly.glb, if the caller has them
   *  (fish-3d-demo.ts embeds them at build time). Unlike the app, there's no
   *  async fetch here — the demo page is fully self-contained, so the bytes
   *  are already available synchronously by the time this runs. */
  glbBytes?: ArrayBuffer,
): () => void {
  const { scene: sceneCfg, decor } = design;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(sceneCfg.background);
  scene.fog = new THREE.FogExp2(new THREE.Color(sceneCfg.fog.color).getHex(), sceneCfg.fog.density);

  const cam = sceneCfg.camera.tank;
  const camera = new THREE.PerspectiveCamera(
    sceneCfg.camera.fov,
    1,
    sceneCfg.camera.near,
    sceneCfg.camera.far,
  );
  camera.position.set(...cam.position);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(...cam.target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxDistance = 30;
  controls.minDistance = 3;

  // Everything below comes from the same tank-design.ts the app reads, so this
  // preview can't drift away from the device the way it silently had before.
  const { hemisphere, key, fill: fillCfg } = sceneCfg.lights;
  scene.add(new THREE.HemisphereLight(hemisphere.sky, hemisphere.ground, hemisphere.intensity));
  const sun = new THREE.DirectionalLight(key.color, key.intensity);
  sun.position.set(...key.position);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(fillCfg.color, fillCfg.intensity);
  fill.position.set(...fillCfg.position);
  scene.add(fill);

  const backdrop = createBackdrop(design);
  scene.add(backdrop);

  const sand = createSand(TANK_HALF_WIDTH * 2.6, TANK_HALF_DEPTH * 2.6, design);
  scene.add(sand.mesh);

  const halfW = TANK_HALF_WIDTH * 0.9;
  const halfD = TANK_HALF_DEPTH * 0.9;
  const topY = 5;
  const plants = createPlants(decor.plants.count, halfW, halfD, design);
  scene.add(plants.group);
  const rocks = createRocks(decor.rocks.count, halfW, halfD, design);
  scene.add(rocks);
  scene.add(createDriftwood(halfW, halfD, design));
  const bubbles = createBubbles(decor.bubbles.count, halfW, halfD, topY, design);
  scene.add(bubbles.group);
  const particles = createParticles(
    design.water.particles.count,
    TANK_HALF_WIDTH,
    TANK_HALF_DEPTH,
    topY,
    design,
  );
  scene.add(particles.points);

  const box: WanderBox = {
    minX: -TANK_HALF_WIDTH,
    maxX: TANK_HALF_WIDTH,
    minY: -TANK_HALF_DEPTH,
    maxY: TANK_HALF_DEPTH,
  };

  const fishes: TrackedFish[] = specs.map((spec) => {
    const skin = skinTexture(spec.traits);
    const fish3d =
      design.fish.useGlbModel && glbBytes
        ? createGlbFishMesh(spec.palette, { skin, design, bytes: glbBytes })
        : createFishMesh(spec.palette, {
            skin,
            design,
            tail: spec.traits.tail,
            dorsal: spec.traits.dorsal,
          });
    scene.add(fish3d.group);
    const seed = seedFromString(spec.id);
    const state = initSwimState(box, seed);
    const scale = 0.9 + ((seed * 53) % 1) * 0.5;
    fish3d.group.scale.setScalar(scale);
    return { fish3d, state, phase: seed * Math.PI * 2 };
  });

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }
  window.addEventListener("resize", resize);
  resize();

  let last = performance.now();
  let raf = 0;
  function frame(now: number) {
    const dt = Math.min(0.064, (now - last) / 1000);
    last = now;
    for (const f of fishes) {
      const s = f.state;
      stepSwim(s, box, dt, 1, f.phase, Math.random);

      f.fish3d.group.position.set(s.x, bobFor(now, f.phase, design), s.y);
      f.fish3d.group.rotation.y = yawFor(s.theta, design);
      f.fish3d.group.rotation.z = bankFor(s.facingRight, s.turnRate, design);

      f.fish3d.update(s.beatPhase, s.speedNorm, f.phase);
    }
    const t = now / 1000;
    sand.update(t);
    plants.update(t, dt);
    bubbles.update(t, dt);
    particles.update(t, dt);
    controls.update();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
    controls.dispose();
    renderer.dispose();
  };
}
