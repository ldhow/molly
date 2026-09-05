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
  /** Degrees (0 = +x/right, -90 = straight up). Deliberately well short of vertical — aquarium wood sprawls low across the substrate; near -90 it reads as a bonsai. `mirror` flips which way a piece sweeps, not this. */
  headingBase: number;
  headingRange: number;
  /** Organic per-segment wander, degrees. */
  wanderDeg: number;
  trunkSegments: number;
  /** Near-horizontal roots flaring from the base, alternating sides, so the piece meets the sand at several points instead of balancing on one. */
  rootCountMin: number;
  rootCountRange: number;
  /** Degrees off horizontal — small, so roots hug the substrate. */
  rootHeadingBase: number;
  rootHeadingRange: number;
  /** Root length as a fraction of trunk height. */
  rootLenMin: number;
  rootLenRange: number;
  /** Root base width as a fraction of the trunk's. */
  rootWidthFactor: number;
  rootSegments: number;
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
  /**
   * Moss over the stone's crown. Sampled straight off the sprite art
   * (`rock-a.png`, `rock-huge.png`, `rock-small.png`): in every one of them
   * the stone is a MOSSY dome, never bare rock, and that green cap is most of
   * what makes it read as an aquarium stone rather than a grey polygon. The
   * procedural stone had no equivalent at all.
   */
  mossDarkColor: string;
  mossMidColor: string;
  mossLightColor: string;
  /** How far down the stone the moss reaches, as a fraction of its height. */
  mossCoverage: number;
  /** Scalloped blobs along the crown — the moss edge is lumpy, never a clean line. */
  mossBlobCountMin: number;
  mossBlobCountRange: number;
  /** Loose stones at the foot, also straight from the sprite art — no boulder there sits on clean sand. */
  pebbleCountMin: number;
  pebbleCountRange: number;
  /** As a fraction of the stone's own width. */
  pebbleRadiusMin: number;
  pebbleRadiusRange: number;
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
  /**
   * Needles per WHORL. `cabomba.png` is a bottlebrush: at every node a whole
   * fan of fine needles radiates out on both sides, and the overlapping fans
   * are what make the plant read as feathery. The generator used to emit ONE
   * needle per station, alternating sides, which read as a bare wire with
   * specks stuck to it.
   */
  whorlNeedleCountMin: number;
  whorlNeedleCountRange: number;
  /** Total angular spread of one side's fan, degrees. */
  whorlArcDeg: number;
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
  /**
   * Scene-wide key light, as a direction in each piece's LOCAL space (+y
   * down, so a light from above is negative y). Every generator that shades
   * across a form must read this rather than choosing its own: decor lit from
   * inconsistent directions reads worse than decor that is uniformly flat.
   * Matches the god-ray shafts in `core/sksl/water.ts`, which lean down-right
   * from the surface — so the light arrives from up and slightly left.
   */
  lighting: {
    dirX: number;
    dirY: number;
    /** How far the shaded edge drops below the base colour, 0-1. */
    formDarken: number;
    /** How far the lit edge rises above it, 0-1. Deliberately smaller than `formDarken` — a blown highlight reads as plastic. */
    formLighten: number;
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
  /**
   * `spriteSize` is the bubble sprite in px at scale 1. Kept small on
   * purpose: at 28 a bubble was ~7% of a 390px canvas width, which is bigger
   * than a fish eye and read as floating balls rather than as aeration. The
   * count is raised to compensate so the tank does not lose the motion.
   */
  bubbles: { count: number; spriteSize: number };
  layers: {
    opacityFar: number;
    opacityBack: number;
    /** Interpolated between back/mid — only the Decor Store's extra depth tiers ever use this (see `scene/types.ts`'s `SceneLayer` doc). */
    opacityBackMid: number;
    opacityMid: number;
    /** Interpolated between mid/front — decor-tier only, see `opacityBackMid`. */
    opacityFrontMid: number;
    opacityFront: number;
    /** Same as front — decor-tier only, see `opacityBackMid`. */
    opacityFrontMost: number;
    /**
     * How far each layer is pulled toward the water haze colour — the other
     * half of atmospheric perspective, alongside the opacity table above.
     *
     * Alpha alone does not read as distance: a back piece at `opacityFar`
     * over bright water goes translucent and shows the background through
     * its middle, which reads as a decal in front of the water, not an
     * object far inside it. Real distance underwater desaturates and tints
     * toward the water while staying opaque. Lives here rather than in the
     * renderer so `scripts/aquarium-preview.ts` composites the same way the
     * device does — it previously drew sprites with a bare paint and showed
     * no depth falloff at all.
     */
    hazeFar: number;
    hazeBack: number;
    hazeBackMid: number;
    hazeMid: number;
    hazeFrontMid: number;
    /** The colour distance is hazed toward — the mid/bottom water tone actually behind decor, not the pale surface. */
    hazeColor: string;
    /** Opacity falloff is compressed by this once haze carries the depth cue; 1 = use the table raw. */
    hazeOpacityRelief: number;
    /** How far a swaying piece leans with the shared tank current, on top of its own faster individual flutter. */
    currentLean: number;
    /** Autonomous horizontal drift camera — px at `parallaxFront` (factor 1). */
    parallaxAmplitude: number;
    parallaxPeriodSec: number;
    /** Per-layer fraction of `parallaxAmplitude` actually applied — smaller for farther layers. */
    parallaxFar: number;
    parallaxBack: number;
    /** Interpolated between back/mid — decor-tier only, see `opacityBackMid`. */
    parallaxBackMid: number;
    parallaxMid: number;
    /** Interpolated between mid/front — decor-tier only, see `opacityBackMid`. */
    parallaxFrontMid: number;
    parallaxFront: number;
    /** Same as front — decor-tier only, see `opacityBackMid`. */
    parallaxFrontMost: number;
  };
}

export const DEFAULT_SCENE_DESIGN: SceneDesign = {
  species: {
    driftwood: {
      // Sampled from `driftwood-log.png`'s bark (its p25/p50 bands, excluding
      // the moss growing over it). The old mid `#5c4029` sat a full stop
      // darker than the painted log, which is why generated wood read as a
      // charred twig beside it.
      darkColor: "#44361e",
      midColor: "#725329",
      highlightColor: "#a98757",
      knotColor: "#2a2916",
      knotCountMin: 1,
      knotCountRange: 2,
      knotRadiusMin: 2.2,
      knotRadiusRange: 1.6,
      contactShadowRadius: 1.3,
      contactShadowStrength: 0.32,
      heightMin: 118,
      heightRange: 72,
      // `driftwood-log.png` is 320x168 — a piece roughly twice as wide as it
      // is tall, whose trunk is a good fifth of its own length thick. At
      // 15-22 against a 118-190 trunk this generator was drawing something
      // nearer 1:8, i.e. a twig. Widening the trunk is what lets the branch
      // and root factors below inherit real thickness too, since both are
      // expressed as fractions of it.
      baseWidthMin: 26,
      baseWidthRange: 10,
      headingBase: -42,
      headingRange: 38,
      wanderDeg: 26,
      trunkSegments: 6,
      rootCountMin: 2,
      rootCountRange: 2,
      rootHeadingBase: 6,
      rootHeadingRange: 20,
      rootLenMin: 0.26,
      rootLenRange: 0.26,
      rootWidthFactor: 0.62,
      rootSegments: 3,
      branchCountMin: 3,
      branchCountRange: 2,
      forkTMin: 0.3,
      forkTRange: 0.5,
      forkAngleMin: 30,
      forkAngleRange: 40,
      branchLenMin: 0.32,
      branchLenRange: 0.3,
      branchWidthFactor: 0.46,
      branchSegments: 4,
      lowAnchorT: 0.15,
      lowAnchorAngleBase: -100,
      lowAnchorAngleRange: 40,
    },
    anubias: {
      // From `anubias-a.png` — the one sprite whose subject IS this species.
      leafDarkColor: "#1e6434",
      leafMidColor: "#3e8433",
      leafTipLighten: 0.24,
      veinColor: "#144023",
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
      // Ramp lifted off `tall-grass.png` (see this block's palette note): a
      // strap blade runs deep green in its shaded fold to a near-chartreuse
      // edge, and it is that VALUE SPAN, not the hue, that reads as a lit
      // leaf. The old trio spanned barely 15% lightness and all three were
      // the same blue-green, so a clump read as flat cut paper.
      color1: "#3d7f1a",
      color2: "#296719",
      color3: "#53921c",
      bladeCountMin: 5,
      bladeCountRange: 4,
      heightMin: 180,
      heightRange: 140,
      leanBase: 5,
      leanJitter: 7,
      curveRange: 32,
      bladeSpacing: 5,
      // Blades are RIBBONS, not wires. At 2.2 a clump scaled up for the
      // background canopy came out ~100:1 — thinner than any real vallisneria
      // and thin enough to alias away against the water. Raised again to 7.5
      // to match the sprite: `tall-grass.png` is 222x414 carrying ~9 blades,
      // i.e. roughly 13:1 per blade, against the ~40:1 these were drawing.
      // That single number is most of why the procedural scene read as wire
      // where the painted one reads as foliage.
      widthMin: 7.5,
      widthRange: 3.5,
      swayHeightFactor: 90,
    },
    stemBush: {
      // From `leafy-bush.png`.
      leafColor1: "#24631c",
      leafColor2: "#428110",
      leafColor3: "#1a4c1a",
      stemColor: "#0f3917",
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
      // Stone ramp from `rock-small.png`'s bare faces — warmer and greener
      // than the old neutral grey, because in the sprite art even the
      // unmossed rock carries a green cast bounced off everything around it.
      darkColor: "#3a4438",
      midColor: "#576b51",
      lightColor: "#84876e",
      widthMin: 92,
      widthRange: 58,
      // Rounder than before (was 60+42). Every sprite rock is a DOME —
      // `rock-huge.png` is a broad rounded hump — where this generator's
      // low-and-wide jagged wedge read as rubble. The silhouette is still
      // faceted; it just sits taller relative to its width now.
      heightMin: 74,
      heightRange: 48,
      // More vertices than the original 8-12: at that count the per-vertex
      // radius jitter below lands on a coarse polygon, so each perturbation
      // became a visible corner and the stone read as chipped slate. Sampling
      // the dome more finely lets the same jitter read as surface irregularity
      // on a rounded boulder — which is the silhouette every sprite rock has.
      vertexCountMin: 16,
      vertexCountRange: 6,
      // Tightened from 0.78+0.44: at that spread the radius could nearly
      // double between neighbouring vertices, which is what made the
      // silhouette read as shattered slate rather than a weathered boulder.
      jitterMin: 0.88,
      jitterRange: 0.2,
      facetCountMin: 1,
      facetCountRange: 2,
      seamColor: "#e1deda",
      // Moss ramp from `moss-ball.png` / the mossed crowns of `rock-a.png`.
      mossDarkColor: "#235705",
      mossMidColor: "#476d0b",
      mossLightColor: "#6f9607",
      mossCoverage: 0.62,
      mossBlobCountMin: 5,
      mossBlobCountRange: 4,
      pebbleCountMin: 2,
      pebbleCountRange: 3,
      pebbleRadiusMin: 0.05,
      pebbleRadiusRange: 0.045,
    },
    substrateMound: {
      topColor: "#6b5540",
      bottomColor: "#4a3a29",
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
      // From `kelp.png`. The old trio topped out at #1e4932 — so dark that a
      // clump was a black cutout at any size, which the theme comment in
      // `nature-scape.ts` describes as reading like "flat dark PLANKS". The
      // sprite's own kelp is a legible mid-green with a bright lit edge.
      color1: "#377f30",
      color2: "#226332",
      color3: "#539832",
      // Six-ish fronds, not three. At three, a clump this tall reads as a
      // few flat dark PLANKS rather than planting — the fronds are ~20:1
      // aspect and never overlap, so nothing tells you it's a mass. More
      // fronds at a slightly greater lean/curve spread is what turns it back
      // into a silhouette you read as foliage.
      frondCountMin: 5,
      frondCountRange: 3,
      heightMin: 430,
      heightRange: 180,
      leanMin: 16,
      leanRange: 36,
      curveMin: 12,
      curveRange: 30,
      widthMin: 20,
      widthRange: 12,
      swayHeightFactor: 150,
    },
    bloom: {
      petalColor1: "#d98ac4",
      petalColor2: "#c377d8",
      petalColor3: "#e79ec6",
      stemColor: "#3a7342",
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
      // From `cabomba.png`.
      stalkColor: "#26601e",
      leafletColor1: "#2d691c",
      leafletColor2: "#4f921e",
      leafletColor3: "#1e5715",
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
      leafletLenMin: 10,
      leafletLenRange: 7,
      whorlNeedleCountMin: 4,
      whorlNeedleCountRange: 3,
      whorlArcDeg: 74,
      swayHeightFactor: 110,
    },
    sword: {
      // From `grass-spiky.png` — the spiky strap-leaf sprite this species is
      // the procedural equivalent of.
      leafDarkColor: "#1d5314",
      leafMidColor: "#458517",
      leafTipLighten: 0.24,
      veinColor: "#12360c",
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
      // From `moss-ball.png` — a tight mound of small bright leaves, which is
      // exactly what a carpet clump is.
      leafColor1: "#476d0b",
      leafColor2: "#235705",
      leafColor3: "#6f9607",
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
  lighting: { dirX: -0.45, dirY: -0.89, formDarken: 0.3, formLighten: 0.16 },
  // PLANT AND HARDSCAPE COLOURS ABOVE ARE SAMPLED FROM THE SPRITE ART, not
  // chosen by eye. Every ramp cites the `assets/images/scene/*.png` it came
  // from; they were read out of the actual pixels (opaque-only, by luminance
  // percentile) so the procedural mode and the painted mode agree on what a
  // plant is coloured like. Two properties of that art carry the look, and
  // both are easy to undo by accident:
  //
  //   - YELLOW-GREEN, not blue-green. Every sampled leaf highlight has a
  //     blue channel near zero (#92bf18, #b1cc0c, #71a70c). The palette this
  //     replaced was built on spring-greens like #3d984b/#439a5b, whose blue
  //     channel is 3-4x higher — that one difference is most of why the
  //     generated scene read cold and synthetic beside the painted one.
  //   - A WIDE VALUE SPAN per species. The sampled ramps run from a deep
  //     shadow (~#1a4c1a) to a near-chartreuse lit edge (~#71a70c). The old
  //     trios spanned barely 15% lightness, so form shading had nothing to
  //     work with and every leaf read flat.
  //
  // The WATER below is deliberately NOT sampled from the sprites: it stays
  // the softer freshwater-pond gradient (green, not cyan; low top-to-bottom
  // contrast, so a shallow pond rather than a deep tank). Sprite mode has its
  // own brighter cyan water in `render/sprite-layers.tsx`; the two art modes
  // are allowed to disagree about the WATER even while agreeing about plants.
  water: { top: "#7ac8b6", mid: "#3d8f8a", bottom: "#1a4950" },
  substrate: {
    top: "#c8b48c",
    bottom: "#8b7a58",
    grainStrength: 0.04,
    speckleDensity: 0.1,
    speckleColor: "#5a4d38",
  },
  bubbles: { count: 18, spriteSize: 15 },
  layers: {
    opacityFar: 0.45,
    opacityBack: 0.7,
    opacityBackMid: 0.85,
    opacityMid: 1,
    opacityFrontMid: 1,
    opacityFront: 1,
    opacityFrontMost: 1,
    hazeFar: 0.62,
    hazeBack: 0.4,
    hazeBackMid: 0.24,
    hazeMid: 0.1,
    hazeFrontMid: 0.04,
    hazeColor: "#3d99b8",
    hazeOpacityRelief: 0.4,
    currentLean: 0.05,
    parallaxAmplitude: 14,
    parallaxPeriodSec: 48,
    parallaxFar: 0.15,
    parallaxBack: 0.35,
    parallaxBackMid: 0.5,
    parallaxMid: 0.65,
    parallaxFrontMid: 0.825,
    parallaxFront: 1,
    parallaxFrontMost: 1,
  },
};
