// EVERY tunable value in the 3D tank, in one place.
//
// This is the single source of truth that the app (tank-canvas-3d.tsx), the
// browser preview (scripts/lib/fish-3d-driver.ts) and the design editor
// (`yarn tank:design`) all read. Before it existed these were literals buried
// in three different files, the preview had silently drifted from the app,
// and nothing could be tuned without editing code.
//
// Deliberately dependency-free — plain data, no three/React/RN imports — so
// it can be bundled for the browser tool, imported by Node verification
// scripts, and serialized back to disk by the editor's Save button.
//
// `yarn tank:design` overwrites this file. Everything in it is generated-shape
// config; don't add hand-written logic here or Save will eat it. Behavioural
// code belongs in the modules that consume this.
//
// Changing a default is a real visual change: `yarn verify:3d` pins several
// fingerprints and will fail on purpose so the diff is visible in review.

import type { DorsalId, TailId } from "@/shared/fish/types";

export type Vec3 = [x: number, y: number, z: number];
export type Vec2 = [x: number, y: number];

// ---------------------------------------------------------------------------
// Fish
// ---------------------------------------------------------------------------

/**
 * A named point on the body's side profile. `z` runs nose (−1) to tail (+1);
 * `y` is up. These mirror the 2D art's landmarks in `bodyGeom()`, so the two
 * renderers can be reasoned about with the same vocabulary.
 */
export interface BodyLandmark {
  z: number;
  y: number;
}

export interface FinDesign {
  /** Hinge point in mesh space — the fin rotates and attaches here. */
  pivot: Vec3;
  /** Outer edge of the membrane, fanned from the pivot. */
  tips: Vec3[];
  /** Build a mirrored copy on the other flank (pectorals, pelvics). */
  mirrored: boolean;
}

export interface FishShapeDesign {
  /**
   * The body silhouette as named landmarks rather than an anonymous curve.
   *
   * The top edge runs nose → backPeak → peduncleTop → tailBase and the bottom
   * runs nose → bellyLow → peduncleBottom → tailBase, each interpolated
   * separately. That independence is the point: a lathe (which this replaced)
   * revolves one radius and is therefore forced to be vertically symmetric,
   * so it could never give a molly its deep belly and higher back.
   */
  landmarks: {
    nose: BodyLandmark;
    backPeak: BodyLandmark;
    bellyLow: BodyLandmark;
    peduncleTop: BodyLandmark;
    peduncleBottom: BodyLandmark;
    tailBase: BodyLandmark;
  };
  /** Half-width at the deepest part of the body. Fish are laterally flat. */
  maxHalfWidth: number;
  /**
   * How sharply width tapers with height. 1 = width tracks height exactly;
   * lower keeps the fish full-bodied further toward nose and tail.
   */
  widthFalloff: number;
  /** Cross-section roundness: 2 = ellipse, higher = slab-sided like a real molly. */
  crossSectionExponent: number;
  /** Rings along the spine — lengthwise smoothness and undulation resolution. */
  spineStations: number;
  /** Vertices around each ring. */
  ringSegments: number;
  fins: {
    /**
     * Keyed by trait id, not a single fin — `TailId`/`DorsalId` are real,
     * fully-implemented 2D trait values (render-spec.ts's `tailGeom()` /
     * `dorsalGeom()`); a fish can already roll a lyretail tail or sailfin
     * dorsal, so 3D needs a shape for each value, not just one.
     *
     * Pelvic/anal/pectoral aren't 2D trait axes, so they stay single.
     */
    tail: Record<TailId, FinDesign>;
    dorsal: Record<DorsalId, FinDesign>;
    pelvic: FinDesign;
    anal: FinDesign;
    pectoral: FinDesign;
  };
  eye: {
    radius: number;
    widthSegments: number;
    heightSegments: number;
    /** Lateral offset, height, and position along the spine (mesh space). */
    x: number;
    y: number;
    z: number;
    color: string;
    roughness: number;
  };
}

export interface FishMaterialDesign {
  body: { roughness: number; metalness: number };
  fin: { opacity: number; roughness: number; doubleSide: boolean };
}

export interface FishMotionDesign {
  /**
   * Extra gain on body undulation, ON TOP of the shared px→units conversion.
   *
   * The wave itself (`waveDy` in swim-model.ts) is shared with the 2D Skia
   * renderer and must not be edited here — changing it would silently reshape
   * the 2D fish too. This multiplier is 3D-only. 1 = matches 2D.
   */
  waveMultiplier: number;
  tailAmpBase: number;
  tailAmpSpeed: number;
  /** Spatial wave number; keep in step with `waveDy`'s or the tail desyncs from the body. */
  tailWaveNumber: number;
  /** How far the tail trails the body wave, radians. */
  tailLag: number;
  /** Pectorals scull harder when idle, so speed REDUCES this. */
  pectoralBase: number;
  pectoralIdleGain: number;
  pectoralBeatMultiple: number;
  pectoralPhase: number;
  bobPeriodMs: number;
  bobAmplitude: number;
  bankGain: number;
  bankClamp: number;
  /** Aligns the model's forward axis (-Z) to the swim heading. Coupled to the lathe rotation. */
  yawOffset: number;
}

export interface FishDeadDesign {
  /** sRGB luma weights + lift, matching 2D's DEAD_GRAYSCALE_MATRIX. */
  lumaR: number;
  lumaG: number;
  lumaB: number;
  lift: number;
  /** Height above the sand a corpse rests at. */
  restOffsetY: number;
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

export interface CameraDesign {
  position: Vec3;
  target: Vec3;
}

export interface SceneDesign {
  camera: { tank: CameraDesign; center: CameraDesign; fov: number; near: number; far: number };
  background: string;
  fog: { color: string; density: number };
  lights: {
    hemisphere: { sky: string; ground: string; intensity: number };
    key: { color: string; intensity: number; position: Vec3 };
    fill: { color: string; intensity: number; position: Vec3 };
  };
  framing: {
    /** Width of the virtual pixel box the swim model runs in. */
    virtualWidth: number;
    /** World-unit Z range fish may roam, per mode. */
    depthSpan: { tank: number; center: number };
    /** Fraction of the visible width fish may use, per mode. */
    widthFraction: { tank: number; center: number };
    sandWidthMultiple: number;
    sandDepthMultiple: number;
    particleSpreadMultiple: number;
  };
  /** Slow-motion factor for the single fish on the session screen. */
  centerSpeedFactor: number;
}

// ---------------------------------------------------------------------------
// Water
// ---------------------------------------------------------------------------

export interface WaterDesign {
  backdrop: {
    radius: number;
    widthSegments: number;
    heightSegments: number;
    top: string;
    bottom: string;
    /** <1 pushes the bright band higher up the dome. */
    gradientExponent: number;
  };
  sand: {
    tessellationX: number;
    tessellationY: number;
    duneSeed: number;
    duneFrequency: number;
    duneOffset: number;
    duneAmplitude: number;
    grainRepeat: Vec2;
    texture: {
      size: number;
      seed: number;
      baseFrequency: number;
      patchFrequency: number;
      brightness: number;
      grainContrast: number;
      patchDarken: number;
      /** Base sand colour, 0-255 per channel. */
      rgb: Vec3;
    };
    material: {
      roughness: number;
      envMapIntensity: number;
      emissive: string;
      emissiveIntensity: number;
      lightMapIntensity: number;
    };
  };
  caustics: {
    size: number;
    seed: number;
    /** Cell size of the caustic web — lower means bigger cells. */
    cellFrequency: number;
    /** Ridged-noise falloff: only crests above `threshold` survive. */
    threshold: number;
    normalizer: number;
    exponent: number;
    repeatA: Vec2;
    repeatB: Vec2;
    /** Scroll speeds; the two layers cross to make the shimmer. */
    scrollA: Vec2;
    scrollB: Vec2;
  };
  particles: {
    count: number;
    seed: number;
    dotSize: number;
    riseMin: number;
    riseVariance: number;
    color: string;
    size: number;
    opacity: number;
    wobbleRate: number;
    wobbleAmplitude: number;
  };
}

// ---------------------------------------------------------------------------
// Decor
// ---------------------------------------------------------------------------

export interface PlantSpeciesDesign {
  id: string;
  /** Relative chance of a clump being this species. */
  weight: number;
  bladeCount: Vec2;
  height: Vec2;
  width: Vec2;
  /** Base colours picked between, and the colour tips fade toward. */
  base: string[];
  tip: string;
  swayAmp: number;
  /** Lean away from vertical, radians — gives bushy species their shape. */
  spread: number;
}

export interface DecorDesign {
  /** Sand surface height. Everything floor-rooted references this. */
  groundY: number;
  leaf: {
    width: number;
    height: number;
    /** <1 puts the widest point nearer the root. */
    widestBias: number;
    maxHalfWidth: number;
    minStalkWidth: number;
    ribWidth: number;
    ribDarkness: number;
  };
  species: PlantSpeciesDesign[];
  plants: {
    count: number;
    seed: number;
    /** Keeps clumps off the very edge of the tank. */
    inset: number;
    /** Vertical segments per blade — sway smoothness. */
    segments: number;
    /** How far the tip colour blends in (never fully). */
    tipBlend: number;
    alphaTest: number;
    roughness: number;
    /** Per-blade scatter around its clump centre. */
    jitter: number;
    swayVarianceMin: number;
    swayVarianceMax: number;
    swayRateX: number;
    swayWaveNumber: number;
    swayRateZ: number;
    swayCrossRatio: number;
  };
  bubbles: {
    count: number;
    seed: number;
    widthSegments: number;
    heightSegments: number;
    color: string;
    opacity: number;
    roughness: number;
    metalness: number;
    envMapIntensity: number;
    radiusMin: number;
    radiusVariance: number;
    spread: number;
    speedMin: number;
    speedVariance: number;
    wobbleRate: number;
    wobbleAmplitude: number;
  };
  rocks: {
    count: number;
    seed: number;
    /** The first N are subdivided so they don't read as dice. */
    bigCount: number;
    roughenAmount: number;
    colorA: string;
    colorB: string;
    roughness: number;
    sizeBig: number;
    sizeSmall: number;
    sizeVariance: number;
    /** Fraction of its size a rock sinks into the sand. */
    sinkFactor: number;
    spread: number;
  };
  driftwood: {
    seed: number;
    color: string;
    roughness: number;
    rootXFactor: number;
    rootZMin: number;
    rootZVariance: number;
    leanMin: number;
    leanVariance: number;
    trunkLengthMin: number;
    trunkLengthVariance: number;
    trunkRadius: number;
    trunkSegments: number;
    trunkRadialSegments: number;
    trunkJitter: number;
    branchMin: number;
    branchVariance: number;
    branchRadius: number;
    branchSegments: number;
    branchRadialSegments: number;
    branchLengthMin: number;
    branchLengthVariance: number;
    branchJitter: number;
  };
}

// ---------------------------------------------------------------------------

export interface TankDesign {
  fish: {
    shape: FishShapeDesign;
    material: FishMaterialDesign;
    motion: FishMotionDesign;
    dead: FishDeadDesign;
    /**
     * Render fish from the imported assets/models/short_molly.glb mesh instead of
     * the procedural swept body. Fully reversible — the procedural system
     * (landmarks, per-trait fins, the shape editor) is untouched either way,
     * this just picks which `FishMesh3D` builder every call site uses. See
     * `createGlbFishMesh()` in fish-mesh-3d.ts for what's traded away: no
     * separable fin animation, no balloon/lyretail/sailfin trait shapes.
     */
    useGlbModel: boolean;
  };
  scene: SceneDesign;
  water: WaterDesign;
  decor: DecorDesign;
  /** Albedo texture resolution per art unit. Higher costs JS-thread bake time. */
  skinPxPerUnit: number;
  /** Rasterizer anti-aliasing factor. */
  skinSupersample: number;
}

export const DEFAULT_TANK_DESIGN: TankDesign = {
  fish: {
    shape: {
      // Proportioned from the 2D body: back sits higher than the belly is
      // deep (24.4 vs 21.0 art units), the shoulder peaks ahead of midbody,
      // and the peduncle pinches to a narrow waist before the tail.
      landmarks: {
        nose: { z: -1.0, y: 0.0 },
        backPeak: { z: -0.28, y: 0.55 },
        bellyLow: { z: -0.08, y: -0.47 },
        peduncleTop: { z: 0.85, y: 0.13 },
        peduncleBottom: { z: 0.85, y: -0.12 },
        tailBase: { z: 1.0, y: 0.0 },
      },
      maxHalfWidth: 0.25,
      widthFalloff: 0.85,
      crossSectionExponent: 2.4,
      spineStations: 28,
      ringSegments: 14,
      fins: {
        tail: {
          round: {
            pivot: [0, 0, 0.95],
            tips: [
              [0, 0.34, 0.55],
              [0, 0.13, 0.78],
              [0, -0.13, 0.78],
              [0, -0.34, 0.55],
            ],
            mirrored: false,
          },
          // A twin-lobed lyre: two swept-back points with a shallow concave
          // notch pulled in toward the pivot between them, not one convex
          // fan. Tip magnitudes are converted from the 2D lyretail path's
          // corner points (render-spec.ts `tailGeom()`) via the same
          // px-per-mesh-unit factor as the body wave (`WAVE_SCALE` in
          // fish-mesh-3d.ts, MESH_LENGTH / FISH_PX_LENGTH), so the fin's
          // relative reach and height track the 2D shape rather than being
          // guessed independently.
          lyretail: {
            pivot: [0, 0, 0.95],
            tips: [
              [0, 0.5, 0.96],
              [0, 0.24, 0.68],
              [0, -0.08, 0.38],
              [0, -0.3, 0.7],
              [0, -0.43, 0.96],
            ],
            mirrored: false,
          },
        },
        dorsal: {
          standard: {
            pivot: [0, 0.34, -0.1],
            tips: [
              [0, 0.55, -0.25],
              [0, 0.68, 0.05],
              [0, 0.45, 0.3],
            ],
            mirrored: false,
          },
          // A tall banner with a wavy multi-bump crest, ~1.75x the standard
          // dorsal's height — matching the 2D sailfin path's bbox ratio
          // (render-spec.ts `dorsalGeom()`) rather than an arbitrary guess.
          sailfin: {
            pivot: [0, 0.34, -0.1],
            tips: [
              [0, 0.7, -0.35],
              [0, 1.05, -0.05],
              [0, 1.2, 0.1],
              [0, 0.95, 0.35],
              [0, 0.65, 0.55],
            ],
            mirrored: false,
          },
        },
        pelvic: {
          pivot: [0.07, -0.42, -0.05],
          tips: [
            [0.01, -0.04, -0.06],
            [0.03, -0.16, 0.0],
            [0.02, -0.12, 0.1],
          ],
          mirrored: true,
        },
        anal: {
          pivot: [0, -0.32, 0.45],
          tips: [
            [0, -0.04, -0.1],
            [0, -0.22, -0.02],
            [0, -0.2, 0.14],
          ],
          mirrored: false,
        },
        pectoral: {
          pivot: [0.22, -0.08, -0.45],
          tips: [
            [0.3, -0.1, -0.15],
            [0.36, -0.22, 0.02],
            [0.2, -0.28, 0.16],
          ],
          mirrored: true,
        },
      },
      eye: {
        radius: 0.055,
        widthSegments: 12,
        heightSegments: 10,
        x: 0.1,
        y: 0.14,
        z: -0.7,
        color: "#10131a",
        roughness: 0.15,
      },
    },
    material: {
      body: { roughness: 0.32, metalness: 0.08 },
      fin: { opacity: 0.88, roughness: 0.4, doubleSide: true },
    },
    motion: {
      waveMultiplier: 1,
      tailAmpBase: 0.16,
      tailAmpSpeed: 0.14,
      tailWaveNumber: 4.8,
      tailLag: 0.4,
      pectoralBase: 0.1,
      pectoralIdleGain: 0.14,
      pectoralBeatMultiple: 1.7,
      pectoralPhase: 1.3,
      bobPeriodMs: 900,
      bobAmplitude: 0.08,
      bankGain: 0.18,
      bankClamp: 0.25,
      yawOffset: Math.PI / 2,
    },
    dead: { lumaR: 0.3, lumaG: 0.55, lumaB: 0.15, lift: 0.02, restOffsetY: 0.12 },
    useGlbModel: true,
  },
  scene: {
    camera: {
      tank: { position: [0, 2.4, 13], target: [0, -0.3, 0] },
      center: { position: [0, 0.8, 7.5], target: [0, 0, 0] },
      fov: 50,
      near: 0.1,
      far: 100,
    },
    background: "#04121d",
    fog: { color: "#063049", density: 0.045 },
    lights: {
      hemisphere: { sky: "#bfe9ff", ground: "#6d5a3a", intensity: 0.6 },
      key: { color: "#f2fbff", intensity: 1.1, position: [4, 9, 5] },
      fill: { color: "#2fa8ff", intensity: 0.38, position: [-6, 1, -5] },
    },
    framing: {
      virtualWidth: 360,
      depthSpan: { tank: 3.5, center: 1.2 },
      widthFraction: { tank: 0.72, center: 0.5 },
      sandWidthMultiple: 2.2,
      sandDepthMultiple: 2.4,
      particleSpreadMultiple: 1.4,
    },
    centerSpeedFactor: 0.45,
  },
  water: {
    backdrop: {
      radius: 40,
      widthSegments: 20,
      heightSegments: 14,
      top: "#0a4a68",
      bottom: "#03151f",
      gradientExponent: 0.8,
    },
    sand: {
      tessellationX: 48,
      tessellationY: 24,
      duneSeed: 7,
      duneFrequency: 0.6,
      duneOffset: 8,
      duneAmplitude: 0.14,
      grainRepeat: [6, 4],
      texture: {
        size: 256,
        seed: 11,
        baseFrequency: 18,
        patchFrequency: 0.35,
        brightness: 0.78,
        grainContrast: 0.22,
        patchDarken: 0.12,
        rgb: [214, 194, 150],
      },
      material: {
        roughness: 1,
        envMapIntensity: 0.4,
        emissive: "#7fd3ff",
        emissiveIntensity: 0.35,
        lightMapIntensity: 0.55,
      },
    },
    caustics: {
      size: 256,
      seed: 29,
      cellFrequency: 7,
      threshold: 0.35,
      normalizer: 0.65,
      exponent: 2.2,
      repeatA: [3, 2],
      repeatB: [2.3, 1.7],
      scrollA: [0.012, 0.02],
      scrollB: [-0.017, 0.009],
    },
    particles: {
      count: 200,
      seed: 13,
      dotSize: 32,
      riseMin: 0.006,
      riseVariance: 0.016,
      color: "#cfe9ff",
      size: 0.035,
      opacity: 0.5,
      wobbleRate: 0.4,
      wobbleAmplitude: 0.0006,
    },
  },
  decor: {
    groundY: -1.8,
    leaf: {
      width: 64,
      height: 128,
      widestBias: 0.55,
      maxHalfWidth: 0.5,
      minStalkWidth: 0.04,
      ribWidth: 0.12,
      ribDarkness: 0.35,
    },
    species: [
      {
        id: "vallisneria",
        weight: 3,
        bladeCount: [4, 7],
        height: [1.4, 2.8],
        width: [0.1, 0.18],
        base: ["#1f6b4a", "#15794f"],
        tip: "#7fd6a0",
        swayAmp: 0.16,
        spread: 0.25,
      },
      {
        id: "amazonSword",
        weight: 2,
        bladeCount: [3, 5],
        height: [0.9, 1.5],
        width: [0.3, 0.46],
        base: ["#2f8a58", "#3a9c63"],
        tip: "#8fe3ab",
        swayAmp: 0.07,
        spread: 0.5,
      },
      {
        id: "ludwigia",
        weight: 2,
        bladeCount: [3, 6],
        height: [0.8, 1.5],
        width: [0.18, 0.3],
        base: ["#8e2f3a", "#b4453c", "#a03848"],
        tip: "#e08a6a",
        swayAmp: 0.1,
        spread: 0.4,
      },
      {
        id: "javaFern",
        weight: 2,
        bladeCount: [3, 5],
        height: [0.7, 1.3],
        width: [0.22, 0.34],
        base: ["#3f5a2a", "#4d6b31"],
        tip: "#93b562",
        swayAmp: 0.09,
        spread: 0.55,
      },
      {
        id: "cabomba",
        weight: 2,
        bladeCount: [6, 10],
        height: [0.6, 1.2],
        width: [0.07, 0.12],
        base: ["#15794f", "#1f8f5c"],
        tip: "#5fc98d",
        swayAmp: 0.2,
        spread: 0.7,
      },
      {
        id: "rotala",
        weight: 1,
        bladeCount: [4, 7],
        height: [0.7, 1.3],
        width: [0.1, 0.17],
        base: ["#8d4a7a", "#a3557f"],
        tip: "#e8a7c8",
        swayAmp: 0.15,
        spread: 0.45,
      },
    ],
    plants: {
      count: 9,
      seed: 1,
      inset: 0.95,
      segments: 8,
      tipBlend: 0.6,
      alphaTest: 0.5,
      roughness: 0.85,
      jitter: 0.22,
      swayVarianceMin: 0.7,
      swayVarianceMax: 1.3,
      swayRateX: 1.1,
      swayWaveNumber: 1.3,
      swayRateZ: 0.8,
      swayCrossRatio: 0.35,
    },
    bubbles: {
      count: 14,
      seed: 2,
      widthSegments: 10,
      heightSegments: 8,
      color: "#cfeaff",
      opacity: 0.3,
      roughness: 0.05,
      metalness: 0,
      envMapIntensity: 2,
      radiusMin: 0.035,
      radiusVariance: 0.055,
      spread: 0.9,
      speedMin: 0.35,
      speedVariance: 0.5,
      wobbleRate: 1.6,
      wobbleAmplitude: 0.07,
    },
    rocks: {
      count: 6,
      seed: 3,
      bigCount: 2,
      roughenAmount: 0.35,
      colorA: "#6b6558",
      colorB: "#3d4a4f",
      roughness: 0.95,
      sizeBig: 0.3,
      sizeSmall: 0.16,
      sizeVariance: 0.26,
      sinkFactor: 0.25,
      spread: 0.9,
    },
    driftwood: {
      seed: 4,
      color: "#4a3524",
      roughness: 1,
      rootXFactor: 0.55,
      rootZMin: 0.3,
      rootZVariance: 0.4,
      leanMin: 0.55,
      leanVariance: 0.4,
      trunkLengthMin: 1.1,
      trunkLengthVariance: 0.7,
      trunkRadius: 0.1,
      trunkSegments: 12,
      trunkRadialSegments: 6,
      trunkJitter: 0.12,
      branchMin: 2,
      branchVariance: 2,
      branchRadius: 0.045,
      branchSegments: 8,
      branchRadialSegments: 5,
      branchLengthMin: 0.4,
      branchLengthVariance: 0.6,
      branchJitter: 0.1,
    },
  },
  skinPxPerUnit: 3,
  skinSupersample: 2,
};
