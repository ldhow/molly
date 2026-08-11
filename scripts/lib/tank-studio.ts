// Client-side scene manager for the design editor (`yarn tank:design`).
// Bundled into the browser by scripts/tank-design-editor.ts.
//
// Distinct from fish-3d-driver.ts (which renders one fixed demo): this one
// rebuilds on demand from a live TankDesign, and caches the expensive bits so
// dragging a slider stays interactive.
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
import {
  createBubbles,
  createDriftwood,
  createPlants,
  createRocks,
  resetLeafTexture,
  type DecorPiece,
} from "../../src/shared/components/tank/tank-decor-3d";
import type { TankDesign } from "../../src/shared/components/tank/tank-design";
import {
  createBackdrop,
  createParticles,
  createSand,
  type Particles,
  type SandFloor,
} from "../../src/shared/components/tank/tank-env-3d";
import { disposeTree } from "../../src/shared/components/tank/three-dispose";
import { COLOR_DEFS, getColorDef } from "../../src/shared/fish/catalog";
import { buildSkinMap } from "../../src/shared/fish/skin-map";
import type { ColorId, DorsalId, FishTraits, TailId } from "../../src/shared/fish/types";
import { seedFromString } from "../../src/shared/lib/seed";
import { initSwimState, stepSwim, type SwimState } from "../../src/shared/lib/swim-model";

// The imported-model bytes, fetched once from the editor server's own
// /short_molly.glb route (see scripts/tank-design-editor.ts) and cached for the
// page's lifetime. Preloaded at mount so the very first rebuild() can use it
// rather than always falling back to the procedural mesh for one frame.
let glbBytesCache: ArrayBuffer | null = null;
let glbBytesPromise: Promise<ArrayBuffer> | null = null;

function loadGlbBytes(): Promise<ArrayBuffer> {
  if (glbBytesCache) return Promise.resolve(glbBytesCache);
  glbBytesPromise ??= fetch("/short_molly.glb")
    .then((res) => res.arrayBuffer())
    .then((bytes) => {
      glbBytesCache = bytes;
      return bytes;
    });
  return glbBytesPromise;
}

const TANK_HALF_WIDTH = 6;
const TANK_HALF_DEPTH = 4;
const TOP_Y = 5;

export interface StudioOptions {
  /**
   * `"tank"` is the shipped scene — many fish, decor, real swimming.
   * `"fish"` is a rig: one fish held at the origin with no decor, because a
   * fish crossing the tank is impossible to edit part-by-part.
   */
  mode: StudioMode;
  /** Which variety to show. `null` cycles through all of them. */
  colorId: ColorId | null;
  /** Which tail/dorsal trait shape to preview. `null` cycles per fish. */
  tail: TailId | null;
  dorsal: DorsalId | null;
  fishCount: number;
  /** Freeze the swim loop so a shape can be inspected still. */
  paused: boolean;
  showSkin: boolean;
  /** Multiplies swim speed in tank mode. Beat rate is normalised against the
   *  same base, so slowing the fish down doesn't slow its tail to a crawl. */
  speed: number;
}

export type StudioMode = "tank" | "fish";

/**
 * Where the rig starts: dead side-on, matching the shape editor's own side
 * view, at a distance that fills the frame with a 2-unit fish.
 */
const RIG_CAMERA = { position: [3.6, 0.35, 0] as const, target: [0, 0, 0] as const };

/** Rig animation: a relaxed cruise, so fins move without blurring the shape. */
const RIG_BEAT_HZ = 0.9;
const RIG_SPEED_NORM = 0.35;

// Neutral mid-grey, not white or the tank's dark blue: the standard 3D-viewport
// choice, because it sits roughly mid-way in luminance between a fish's dark
// back and pale belly, so neither end of the palette blows out or vanishes.
const RIG_BACKGROUND = "#5a6470";

export interface Studio {
  /** Cheap: mutate materials/lights/fog in place. */
  refreshLive(): void;
  /** Expensive: tear down and rebuild geometry. Debounce this. */
  rebuild(): void;
  /** Snap back to the mode's authored viewpoint, discarding any orbiting. */
  resetCamera(): void;
  setOptions(next: Partial<StudioOptions>): void;
  dispose(): void;
  stats(): { calls: number; triangles: number; programs: number };
}

// Skin bakes cost tens of ms each. They only depend on traits + raster
// resolution, so reshaping the body or relighting the tank must not re-bake.
const skinCache = new Map<string, THREE.Texture>();

function skinFor(traits: FishTraits, design: TankDesign): THREE.Texture {
  const key = `${traits.color}|${traits.body}|${traits.patternSeed ?? 0}|${design.skinPxPerUnit}|${design.skinSupersample}`;
  const hit = skinCache.get(key);
  if (hit) return hit;
  const map = buildSkinMap(traits, getColorDef(traits.color), {
    pxPerUnit: design.skinPxPerUnit,
    supersample: design.skinSupersample,
  });
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
  skinCache.set(key, tex);
  return tex;
}

/** Drop cached skins — only needed when raster resolution changes. */
export function clearSkinCache(): void {
  for (const tex of skinCache.values()) tex.dispose();
  skinCache.clear();
}

interface TrackedFish {
  mesh: FishMesh3D;
  state: SwimState;
  phase: number;
}

export function mountTankStudio(
  canvas: HTMLCanvasElement,
  getDesign: () => TankDesign,
  options: StudioOptions,
): Studio {
  let opts = { ...options };
  const scene = new THREE.Scene();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxDistance = 40;
  controls.minDistance = 1;

  const hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 1);
  const key = new THREE.DirectionalLight(0xffffff, 1);
  const fill = new THREE.DirectionalLight(0xffffff, 1);
  scene.add(hemi, key, fill);

  // Everything rebuilt by `rebuild()` hangs off this, so teardown is one call.
  const content = new THREE.Group();
  scene.add(content);

  let sand: SandFloor | null = null;
  let plants: DecorPiece | null = null;
  let bubbles: DecorPiece | null = null;
  let particles: Particles | null = null;
  let fishes: TrackedFish[] = [];
  /** Rig mode's own beat clock — no SwimState, because nothing is swimming. */
  let rigBeat = 0;
  const box = {
    minX: -TANK_HALF_WIDTH,
    maxX: TANK_HALF_WIDTH,
    minY: -TANK_HALF_DEPTH,
    maxY: TANK_HALF_DEPTH,
  };

  /** Lights, fog, background and camera framing — safe to touch every frame. */
  function refreshLive() {
    const d = getDesign();
    const s = d.scene;
    if (opts.mode === "fish") {
      // White, and no fog: the rig is for reading a silhouette, and the tank's
      // dark water both hides the fish's own dark back and tints it blue.
      scene.background = new THREE.Color(RIG_BACKGROUND);
      scene.fog = null;
    } else {
      scene.background = new THREE.Color(s.background);
      scene.fog = new THREE.FogExp2(new THREE.Color(s.fog.color).getHex(), s.fog.density);
    }

    hemi.color.set(s.lights.hemisphere.sky);
    hemi.groundColor.set(s.lights.hemisphere.ground);
    hemi.intensity = s.lights.hemisphere.intensity;
    key.color.set(s.lights.key.color);
    key.intensity = s.lights.key.intensity;
    key.position.set(...s.lights.key.position);
    fill.color.set(s.lights.fill.color);
    fill.intensity = s.lights.fill.intensity;
    fill.position.set(...s.lights.fill.position);

    camera.fov = s.camera.fov;
    camera.near = s.camera.near;
    camera.far = s.camera.far;
    camera.updateProjectionMatrix();
  }

  function teardown() {
    for (const child of [...content.children]) {
      content.remove(child);
      disposeTree(child);
    }
    fishes = [];
    sand = plants = bubbles = null;
    particles = null;
  }

  function addFish(colorId: ColorId, tail: TailId, dorsal: DorsalId, d: TankDesign): FishMesh3D {
    const traits: FishTraits = {
      color: colorId,
      body: "standard",
      tail,
      dorsal,
      patternSeed: 0,
    };
    const palette: FishPalette = getColorDef(colorId).palette;
    const skin = opts.showSkin ? skinFor(traits, d) : null;
    // Same "mount cheap, upgrade when ready" fallback as the app: if the
    // toggle is on but the one-time fetch hasn't resolved yet, this rebuild
    // shows the procedural mesh; loadGlbBytes().then(rebuild) below re-fires
    // once it has.
    const mesh =
      d.fish.useGlbModel && glbBytesCache
        ? createGlbFishMesh(palette, { skin, design: d, bytes: glbBytesCache })
        : createFishMesh(palette, { skin, design: d, tail, dorsal });
    content.add(mesh.group);
    return mesh;
  }

  function rebuild() {
    const d = getDesign();
    teardown();

    if (opts.mode === "fish") {
      // No decor, no swimming, no scale jitter: one fish parked at the origin
      // in its authored orientation, so a dragged landmark can be seen moving
      // rather than glimpsed as it crosses the tank. Rebuilds are also far
      // cheaper without the plants, which matters while dragging a handle.
      const mesh = addFish(
        opts.colorId ?? COLOR_DEFS[0].id,
        opts.tail ?? "round",
        opts.dorsal ?? "standard",
        d,
      );
      fishes.push({ mesh, state: initSwimState(box, 0), phase: 0 });
    } else {
      // The leaf silhouette is memoised globally; without this, edits to
      // decor.leaf.* would appear to do nothing.
      resetLeafTexture();

      content.add(createBackdrop(d));

      sand = createSand(TANK_HALF_WIDTH * 2.6, TANK_HALF_DEPTH * 2.6, d);
      content.add(sand.mesh);

      const halfW = TANK_HALF_WIDTH * 0.9;
      const halfD = TANK_HALF_DEPTH * 0.9;
      plants = createPlants(d.decor.plants.count, halfW, halfD, d);
      content.add(plants.group);
      content.add(createRocks(d.decor.rocks.count, halfW, halfD, d));
      content.add(createDriftwood(halfW, halfD, d));
      bubbles = createBubbles(d.decor.bubbles.count, halfW, halfD, TOP_Y, d);
      content.add(bubbles.group);
      particles = createParticles(
        d.water.particles.count,
        TANK_HALF_WIDTH,
        TANK_HALF_DEPTH,
        TOP_Y,
        d,
      );
      content.add(particles.points);

      for (let i = 0; i < opts.fishCount; i++) {
        const colorId = opts.colorId ?? COLOR_DEFS[i % COLOR_DEFS.length].id;
        // When a specific trait isn't pinned, cycle it across the roster (like
        // colorId above) so the tank actually shows off both shapes instead of
        // only ever the plain round/standard pair.
        const tail = opts.tail ?? (i % 3 === 0 ? "lyretail" : "round");
        const dorsal = opts.dorsal ?? (i % 4 === 0 ? "sailfin" : "standard");
        const mesh = addFish(colorId, tail, dorsal, d);
        const seed = seedFromString(`studio-${i}-${colorId}`);
        mesh.group.scale.setScalar(0.9 + ((seed * 53) % 1) * 0.5);
        fishes.push({ mesh, state: initSwimState(box, seed), phase: seed * Math.PI * 2 });
      }
    }

    refreshLive();
    applyCamera(d);
  }

  // --- camera ----------------------------------------------------------
  // Shape editing rebuilds geometry on every drag, so snapping the camera
  // back to its authored pose each time made the view unusable — you'd orbit
  // to see a pelvic fin and be thrown back to the front view mid-drag. The
  // camera is therefore only moved when there's a reason to: a mode switch,
  // or an actual edit to the camera design. Each mode keeps its own pose so
  // switching back and forth doesn't lose your framing either.
  const savedPose: Partial<Record<StudioMode, { position: THREE.Vector3; target: THREE.Vector3 }>> =
    {};
  let posedMode: StudioMode | null = null;
  let appliedCameraKey = "";

  function applyCamera(d: TankDesign) {
    const wanted =
      opts.mode === "fish"
        ? { position: [...RIG_CAMERA.position], target: [...RIG_CAMERA.target] }
        : { position: [...d.scene.camera.tank.position], target: [...d.scene.camera.tank.target] };
    const key = JSON.stringify(wanted);

    if (posedMode === opts.mode) {
      // Same mode: only an edit to the camera panel justifies moving.
      if (key === appliedCameraKey) return;
    } else {
      if (posedMode) {
        savedPose[posedMode] = {
          position: camera.position.clone(),
          target: controls.target.clone(),
        };
      }
      const restored = savedPose[opts.mode];
      posedMode = opts.mode;
      appliedCameraKey = key;
      if (restored) {
        camera.position.copy(restored.position);
        controls.target.copy(restored.target);
        controls.update();
        return;
      }
    }

    appliedCameraKey = key;
    camera.position.set(wanted.position[0], wanted.position[1], wanted.position[2]);
    controls.target.set(wanted.target[0], wanted.target[1], wanted.target[2]);
    controls.update();
  }

  /** Put the camera back where the current mode's design says, on request. */
  function resetCamera() {
    appliedCameraKey = "";
    posedMode = opts.mode;
    applyCamera(getDesign());
  }

  function setOptions(next: Partial<StudioOptions>) {
    opts = { ...opts, ...next };
  }

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }
  window.addEventListener("resize", resize);

  let last = performance.now();
  let raf = 0;
  function frame(now: number) {
    const dt = Math.min(0.064, (now - last) / 1000);
    last = now;
    const d = getDesign();
    if (!opts.paused && opts.mode === "fish") {
      // The rig only animates the fish in place: fins beat at a steady
      // moderate effort so the motion reads, but nothing translates, rotates
      // or bobs — a moving target can't be edited.
      rigBeat += Math.PI * 2 * RIG_BEAT_HZ * dt;
      for (const f of fishes) f.mesh.update(rigBeat, RIG_SPEED_NORM, 0);
    } else if (!opts.paused) {
      for (const f of fishes) {
        const s = f.state;
        stepSwim(s, box, dt, opts.speed, f.phase, Math.random);
        f.mesh.group.position.set(s.x, bobFor(now, f.phase, d), s.y);
        f.mesh.group.rotation.y = yawFor(s.theta, d);
        f.mesh.group.rotation.z = bankFor(s.facingRight, s.turnRate, d);
        f.mesh.update(s.beatPhase, s.speedNorm, f.phase);
      }
      const t = now / 1000;
      sand?.update(t);
      plants?.update(t, dt);
      bubbles?.update(t, dt);
      particles?.update(t, dt);
    }
    controls.update();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }

  resize();
  rebuild();
  raf = requestAnimationFrame(frame);
  // Re-render once the model is available, in case the initial rebuild()
  // above ran before the fetch resolved and fell back to the procedural mesh.
  loadGlbBytes()
    .then(() => rebuild())
    .catch(() => {
      /* stays on the procedural mesh — acceptable, not a hard dependency */
    });

  return {
    refreshLive,
    rebuild,
    resetCamera,
    setOptions,
    stats: () => ({
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      programs: renderer.info.programs?.length ?? 0,
    }),
    dispose() {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      teardown();
      controls.dispose();
      renderer.dispose();
    },
  };
}
