// EVERY tunable value behind the tank's background — every decor species'
// shape/size/colour ranges plus the water/substrate/bubble/layer look — in
// one place, in the same spirit as `@/shared/components/tank/tank-design.ts`
// for the 3D tank. Before this existed these were literals buried inside
// `scene/gen/*.ts` function bodies and a handful of `render/*.tsx` consts,
// and none of it could be tuned without editing code.
//
// This is the single source of truth every generator in `scene/gen/` and
// every consumer in `render/water.tsx` / `render/bubbles.tsx` /
// `render/scene-layers.tsx` reads at module scope — the same pattern
// `fish/body-profile.ts`/`fins.ts` already use, which is what lets
// `yarn aquarium:design`'s Shape tab mutate them in place for a live bake.
//
// `yarn aquarium:design`'s Scene tab overwrites this file (via
// `scripts/lib/scene-design-serialize.ts`). Everything in it is generated-
// shape config; don't add hand-written logic here or Save will eat it.
// Behavioural/algorithmic code belongs in the generator that consumes it —
// only the NUMBERS moved here, the "how this shape is built" comments stay
// in `scene/gen/*.ts` next to the math they explain.
//
// Changing a default is a real visual change: `yarn verify:aquarium`'s scene-
// composition checks (column occupancy, corridor, spaciousness, rule-of-
// thirds, asymmetry) will catch a composition that drifts too far.
//
// Dependency-free — plain data, no Skia/React/RN imports — so it can be
// imported by the Node verification/preview scripts and by the editor.

export interface DriftwoodDesign {
  darkColor: string;
  midColor: string;
  /** Lengthwise grain streak along one edge of each limb, screen-blended. */
  highlightColor: string;
  /** Soft dark rings marking where a branch once was — the seiryu-adjacent "character" of real driftwood. */
  knotColor: string;
  knotCountMin: number;
  knotCountRange: number;
  knotRadiusMin: number;
  knotRadiusRange: number;
  /** Soft dark pool where the trunk meets the substrate, multiply-blended. */
  contactShadowRadius: number;
  contactShadowStrength: number;
  heightMin: number;
  heightRange: number;
  baseWidthMin: number;
  baseWidthRange: number;
  /** Degrees, mostly upward (0 = +x/right, -90 = straight up). `mirror` flips which way a piece leans, not this. */
  headingBase: number;
  headingRange: number;
  /** Organic per-segment wander, degrees. */
  wanderDeg: number;
  trunkSegments: number;
  branchCountMin: number;
  branchCountRange: number;
  /** Fraction along the trunk spine where a branch forks off. */
  forkTMin: number;
  forkTRange: number;
  forkAngleMin: number;
  forkAngleRange: number;
  /** Branch length as a fraction of trunk height. */
  branchLenMin: number;
  branchLenRange: number;
  /** Branch base width as a fraction of the trunk's. */
  branchWidthFactor: number;
  branchSegments: number;
  /** Fraction along the trunk where the low (base-level) anchor sits. */
  lowAnchorT: number;
  lowAnchorAngleBase: number;
  lowAnchorAngleRange: number;
}

export interface AnubiasDesign {
  leafDarkColor: string;
  leafMidColor: string;
  /** How far `leafMidColor` is lightened toward white for the leaf tip, 0-1. */
  leafTipLighten: number;
  veinColor: string;
  /** Outward angle (degrees) when NOT mounted on driftwood — attached pieces inherit the anchor's angle instead. */
  unattachedBaseAngle: number;
  leafCountMin: number;
  leafCountRange: number;
  spreadBase: number;
  spreadRange: number;
  angleJitter: number;
  stemLenMin: number;
  stemLenRange: number;
  leafLenMin: number;
  leafLenRange: number;
  /** Leaf width as a fraction of leaf length. */
  leafWidthFactorMin: number;
  leafWidthFactorRange: number;
  /** Half-span of the rhizome stub each side of origin, and the initial bbox padding. */
  rhizomeSpan: number;
  /** How much the rhizome's far end tilts upward. */
  rhizomeTilt: number;
  rhizomeWidth: number;
  stemWidth: number;
  swayHeightFactor: number;
}

export interface VallisneriaDesign {
  color1: string;
  color2: string;
  color3: string;
  bladeCountMin: number;
  bladeCountRange: number;
  heightMin: number;
  heightRange: number;
  leanBase: number;
  leanJitter: number;
  curveRange: number;
  /** Horizontal spacing between adjacent blades' bases. */
  bladeSpacing: number;
  widthMin: number;
  widthRange: number;
  swayHeightFactor: number;
}

export interface StemBushDesign {
  leafColor1: string;
  leafColor2: string;
  leafColor3: string;
  stemColor: string;
  stemCountMin: number;
  stemCountRange: number;
  angleSpreadBase: number;
  angleSpreadRange: number;
  stemLenMin: number;
  stemLenRange: number;
  leafLenMin: number;
  leafLenRange: number;
  /** Leaf width as a fraction of leaf length. */
  leafWidthFactor: number;
  swayHeightFactor: number;
}

export interface SeiryuStoneDesign {
  darkColor: string;
  midColor: string;
  lightColor: string;
  widthMin: number;
  widthRange: number;
  heightMin: number;
  heightRange: number;
  vertexCountMin: number;
  vertexCountRange: number;
  /** Radius jitter around 1.0 — how angular/irregular the silhouette reads. */
  jitterMin: number;
  jitterRange: number;
  /** Interior facet lines splitting the silhouette into light/dark planes — the seiryu signature. */
  facetCountMin: number;
  facetCountRange: number;
  seamColor: string;
}

export interface SubstrateMoundDesign {
  topColor: string;
  bottomColor: string;
  widthMin: number;
  widthRange: number;
  heightMin: number;
  heightRange: number;
  vertexCountMin: number;
  vertexCountRange: number;
  jitterMin: number;
  jitterRange: number;
}

export interface PebblesDesign {
  color1: string;
  color2: string;
  color3: string;
  highlightColor: string;
  countMin: number;
  countRange: number;
  spreadMin: number;
  spreadRange: number;
  radiusMin: number;
  radiusRange: number;
}

export interface KelpDesign {
  color1: string;
  color2: string;
  color3: string;
  frondCountMin: number;
  frondCountRange: number;
  /**
   * Tall on purpose: `compose.ts`'s `sizeFactorFor` clamps to as low as 0.6
   * on a narrow phone canvas (reference width 700), so these numbers are
   * chosen POST-clamp to actually reach near the top of frame — don't tune
   * against the raw value.
   */
  heightMin: number;
  heightRange: number;
  leanMin: number;
  leanRange: number;
  curveMin: number;
  curveRange: number;
  /** Wide on purpose — at narrow widths these read as reeds indistinguishable from vallisneria. */
  widthMin: number;
  widthRange: number;
  swayHeightFactor: number;
}

export interface BloomDesign {
  petalColor1: string;
  petalColor2: string;
  petalColor3: string;
  stemColor: string;
  /**
   * Kept deliberately small and placed at the bottom corners — this is a
   * punctuation mark in the composition, not a mass. Growing it fights the
   * "clear centre" / left-right-asymmetry invariants `verify-aquarium.ts`
   * enforces.
   */
  stemCountMin: number;
  stemCountRange: number;
  angleSpreadBase: number;
  angleSpreadRange: number;
  stemLenMin: number;
  stemLenRange: number;
  petalRadiusMin: number;
  petalRadiusRange: number;
  petalCount: number;
  swayHeightFactor: number;
}

export interface CabombaDesign {
  stalkColor: string;
  leafletColor1: string;
  leafletColor2: string;
  leafletColor3: string;
  stalkCountMin: number;
  stalkCountRange: number;
  heightMin: number;
  heightRange: number;
  leanBase: number;
  leanJitter: number;
  curveRange: number;
  /** Horizontal spacing between adjacent stalks' bases. */
  stalkSpacing: number;
  stalkWidthMin: number;
  stalkWidthRange: number;
  leafletLenMin: number;
  leafletLenRange: number;
  swayHeightFactor: number;
}

export interface SwordDesign {
  leafDarkColor: string;
  leafMidColor: string;
  /** How far `leafMidColor` is lightened toward white for the leaf tip, 0-1. */
  leafTipLighten: number;
  veinColor: string;
  leafCountMin: number;
  leafCountRange: number;
  spreadMin: number;
  spreadRange: number;
  angleJitter: number;
  leafLenMin: number;
  leafLenRange: number;
  /** Leaf width as a fraction of leaf length. */
  leafWidthFactorMin: number;
  leafWidthFactorRange: number;
  droopMin: number;
  droopRange: number;
  swayHeightFactor: number;
}

export interface CarpetDesign {
  leafColor1: string;
  leafColor2: string;
  leafColor3: string;
  clumpCountMin: number;
  clumpCountRange: number;
  leafRadiusMin: number;
  leafRadiusRange: number;
  /** Half-width the clumps scatter across, before `scale`. */
  spreadMin: number;
  spreadRange: number;
  /** Kept low on purpose — a carpet plant hugs the substrate, it doesn't compete with mid/front decor for silhouette height. */
  heightMax: number;
}

export interface RotalaDesign {
  leafColor1: string;
  leafColor2: string;
  leafColor3: string;
  stemColor: string;
  stemCountMin: number;
  stemCountRange: number;
  angleSpreadBase: number;
  angleSpreadRange: number;
  stemLenMin: number;
  stemLenRange: number;
  leafLenMin: number;
  leafLenRange: number;
  /** Leaf width as a fraction of leaf length. */
  leafWidthFactor: number;
  swayHeightFactor: number;
}

export interface SceneDesign {
  species: {
    driftwood: DriftwoodDesign;
    anubias: AnubiasDesign;
    vallisneria: VallisneriaDesign;
    stemBush: StemBushDesign;
    seiryuStone: SeiryuStoneDesign;
    substrateMound: SubstrateMoundDesign;
    pebbles: PebblesDesign;
    kelp: KelpDesign;
    bloom: BloomDesign;
    cabomba: CabombaDesign;
    sword: SwordDesign;
    carpet: CarpetDesign;
    rotala: RotalaDesign;
  };
  water: { top: string; mid: string; bottom: string };
  substrate: {
    top: string;
    bottom: string;
    /** Per-pixel luminance jitter, 0-1 — sand grain. */
    grainStrength: number;
    /** Fraction of cells holding a darker grit speck, 0-1. */
    speckleDensity: number;
    speckleColor: string;
  };
  bubbles: { count: number; spriteSize: number };
  layers: {
    opacityFar: number;
    opacityBack: number;
    opacityMid: number;
    opacityFront: number;
    /** How far a swaying piece leans with the shared tank current, on top of its own faster individual flutter. */
    currentLean: number;
    /** Autonomous horizontal drift camera — px at `parallaxFront` (factor 1). */
    parallaxAmplitude: number;
    parallaxPeriodSec: number;
    /** Per-layer fraction of `parallaxAmplitude` actually applied — smaller for farther layers. */
    parallaxFar: number;
    parallaxBack: number;
    parallaxMid: number;
    parallaxFront: number;
  };
}

export const DEFAULT_SCENE_DESIGN: SceneDesign = {
  species: {
    driftwood: {
      darkColor: "#2c1d14",
      midColor: "#4a3220",
      highlightColor: "#8a6a45",
      knotColor: "#1f140d",
      knotCountMin: 1,
      knotCountRange: 2,
      knotRadiusMin: 2.2,
      knotRadiusRange: 1.6,
      contactShadowRadius: 1.1,
      contactShadowStrength: 0.32,
      heightMin: 150,
      heightRange: 90,
      baseWidthMin: 15,
      baseWidthRange: 7,
      headingBase: -70,
      headingRange: 30,
      wanderDeg: 22,
      trunkSegments: 6,
      branchCountMin: 2,
      branchCountRange: 2,
      forkTMin: 0.35,
      forkTRange: 0.45,
      forkAngleMin: 35,
      forkAngleRange: 35,
      branchLenMin: 0.35,
      branchLenRange: 0.3,
      branchWidthFactor: 0.4,
      branchSegments: 4,
      lowAnchorT: 0.15,
      lowAnchorAngleBase: -100,
      lowAnchorAngleRange: 40,
    },
    anubias: {
      leafDarkColor: "#175c3d",
      leafMidColor: "#2f8f5b",
      leafTipLighten: 0.2,
      veinColor: "#0d3322",
      unattachedBaseAngle: -90,
      leafCountMin: 3,
      leafCountRange: 3,
      spreadBase: 18,
      spreadRange: 8,
      angleJitter: 10,
      stemLenMin: 10,
      stemLenRange: 6,
      leafLenMin: 30,
      leafLenRange: 22,
      leafWidthFactorMin: 0.42,
      leafWidthFactorRange: 0.12,
      rhizomeSpan: 6,
      rhizomeTilt: 1,
      rhizomeWidth: 4,
      stemWidth: 1.4,
      swayHeightFactor: 14,
    },
    vallisneria: {
      color1: "#2e7d57",
      color2: "#256b4a",
      color3: "#35906a",
      bladeCountMin: 4,
      bladeCountRange: 3,
      heightMin: 180,
      heightRange: 140,
      leanBase: 4,
      leanJitter: 6,
      curveRange: 26,
      bladeSpacing: 5,
      widthMin: 2.2,
      widthRange: 1.2,
      swayHeightFactor: 90,
    },
    stemBush: {
      leafColor1: "#1f6b46",
      leafColor2: "#2f8f5b",
      leafColor3: "#175c3d",
      stemColor: "#0d3322",
      stemCountMin: 5,
      stemCountRange: 4,
      angleSpreadBase: 14,
      angleSpreadRange: 6,
      stemLenMin: 34,
      stemLenRange: 40,
      leafLenMin: 13,
      leafLenRange: 9,
      leafWidthFactor: 0.65,
      swayHeightFactor: 24,
    },
    seiryuStone: {
      darkColor: "#2b3038",
      midColor: "#454c57",
      lightColor: "#6b7480",
      widthMin: 92,
      widthRange: 58,
      heightMin: 60,
      heightRange: 42,
      vertexCountMin: 8,
      vertexCountRange: 4,
      jitterMin: 0.78,
      jitterRange: 0.44,
      facetCountMin: 1,
      facetCountRange: 2,
      seamColor: "#c4ccd6",
    },
    substrateMound: {
      topColor: "#5a4632",
      bottomColor: "#3c2e20",
      widthMin: 260,
      widthRange: 140,
      heightMin: 34,
      heightRange: 20,
      vertexCountMin: 10,
      vertexCountRange: 3,
      jitterMin: 0.94,
      jitterRange: 0.12,
    },
    pebbles: {
      color1: "#6b6258",
      color2: "#544c43",
      color3: "#7a7168",
      highlightColor: "#9a9186",
      countMin: 4,
      countRange: 4,
      spreadMin: 60,
      spreadRange: 40,
      radiusMin: 3,
      radiusRange: 4,
    },
    kelp: {
      color1: "#123a30",
      color2: "#0d2f28",
      color3: "#17453a",
      frondCountMin: 3,
      frondCountRange: 2,
      heightMin: 560,
      heightRange: 260,
      leanMin: 14,
      leanRange: 30,
      curveMin: 10,
      curveRange: 26,
      widthMin: 26,
      widthRange: 14,
      swayHeightFactor: 150,
    },
    bloom: {
      petalColor1: "#d98ac4",
      petalColor2: "#c377d8",
      petalColor3: "#e79ec6",
      stemColor: "#2f6b4a",
      stemCountMin: 3,
      stemCountRange: 3,
      angleSpreadBase: 15,
      angleSpreadRange: 9,
      stemLenMin: 16,
      stemLenRange: 16,
      petalRadiusMin: 3.4,
      petalRadiusRange: 1.6,
      petalCount: 5,
      swayHeightFactor: 14,
    },
    cabomba: {
      stalkColor: "#1f4d33",
      leafletColor1: "#2f7d4a",
      leafletColor2: "#3f9d63",
      leafletColor3: "#256b45",
      stalkCountMin: 3,
      stalkCountRange: 3,
      heightMin: 170,
      heightRange: 140,
      leanBase: 4,
      leanJitter: 6,
      curveRange: 22,
      stalkSpacing: 6,
      stalkWidthMin: 1.6,
      stalkWidthRange: 0.6,
      leafletLenMin: 7,
      leafletLenRange: 6,
      swayHeightFactor: 110,
    },
    sword: {
      leafDarkColor: "#0f4a2e",
      leafMidColor: "#3aa06a",
      leafTipLighten: 0.22,
      veinColor: "#0a3320",
      leafCountMin: 5,
      leafCountRange: 4,
      spreadMin: 7,
      spreadRange: 3,
      angleJitter: 10,
      leafLenMin: 55,
      leafLenRange: 40,
      leafWidthFactorMin: 0.16,
      leafWidthFactorRange: 0.06,
      droopMin: 6,
      droopRange: 10,
      swayHeightFactor: 20,
    },
    carpet: {
      leafColor1: "#3f9d63",
      leafColor2: "#2f8f5b",
      leafColor3: "#4fae72",
      clumpCountMin: 6,
      clumpCountRange: 6,
      leafRadiusMin: 2,
      leafRadiusRange: 2,
      spreadMin: 26,
      spreadRange: 24,
      heightMax: 16,
    },
    rotala: {
      leafColor1: "#c25a4a",
      leafColor2: "#a84332",
      leafColor3: "#d97b5f",
      stemColor: "#7a2e22",
      stemCountMin: 5,
      stemCountRange: 4,
      angleSpreadBase: 12,
      angleSpreadRange: 5,
      stemLenMin: 30,
      stemLenRange: 34,
      leafLenMin: 11,
      leafLenRange: 8,
      leafWidthFactor: 0.55,
      swayHeightFactor: 22,
    },
  },
  // Brightened toward the reference's luminous sunlit blue — the old top
  // (#1c4f66) was dark enough that god-ray shafts and kelp silhouettes had
  // nothing to read against. The bottom stays deliberately dark so the
  // top-to-bottom depth gradient still reads.
  water: { top: "#2f86ab", mid: "#175a78", bottom: "#08202e" },
  substrate: {
    top: "#d9c092",
    bottom: "#96805a",
    grainStrength: 0.05,
    speckleDensity: 0.14,
    speckleColor: "#5f4c34",
  },
  bubbles: { count: 14, spriteSize: 28 },
  layers: {
    opacityFar: 0.45,
    opacityBack: 0.7,
    opacityMid: 1,
    opacityFront: 1,
    currentLean: 0.05,
    parallaxAmplitude: 14,
    parallaxPeriodSec: 48,
    parallaxFar: 0.15,
    parallaxBack: 0.35,
    parallaxMid: 0.65,
    parallaxFront: 1,
  },
};
