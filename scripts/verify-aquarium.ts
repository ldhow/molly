// Headless invariants for the aquarium renderer — this repo's stand-in for a
// test suite (there is no test runner yet; see CLAUDE.md). Runs under plain
// Node via `scripts/lib/skia-node.ts`'s CanvasKit-backed Skia, so it exercises
// the SAME emitter (`core/emit.ts`) the app draws with, not an approximation.
//
// Mirrors `scripts/verify-fish-3d.ts`'s shape: print PASS/FAIL per check,
// exit 1 if anything failed.

import { loadSkiaNode } from "./lib/skia-node";
import { bakeNodes } from "@/shared/aquarium/core/bake";
import { boxContainsBox } from "@/shared/aquarium/core/ir";
import type { Box, Node } from "@/shared/aquarium/core/ir";
import { getWarpEffect, WARP_UNIFORM_KEYS } from "@/shared/aquarium/core/sksl/warp";
import { bodyDepthAt, buildFishAnatomy } from "@/shared/aquarium/fish/anatomy";
import { bakeFish, buildFishAquariumSpec, densityAwareDpr } from "@/shared/aquarium/fish/bake-fish";
import { BODY_PROFILES } from "@/shared/aquarium/fish/body-profile";
import { finPivotsFor } from "@/shared/aquarium/fish/fin-secondary";
import type { FinShape } from "@/shared/aquarium/fish/fins";
import {
  distanceToPolygonBoundary,
  pointInPolygon,
  polygonSelfIntersects,
} from "@/shared/aquarium/fish/geometry";
import { linspace, pchip } from "@/shared/aquarium/fish/profile";
import { composeScene, GENERATORS, type PlacedPiece } from "@/shared/aquarium/scene/compose";
import { NATURE_SCAPE } from "@/shared/aquarium/scene/themes/nature-scape";
import {
  CAUDAL_FIN_AMP_MAX,
  finSecondaryInjectivityBudget,
  finSecondaryMaxDisplacement,
  finSecondaryOffset,
  forwardWarp,
  inverseWarp,
  PEC_FIN_AMP_MAX,
  spineInjectivityBudget,
  spineMaxDisplacement,
  SPINE_AMP_MAX,
  SPINE_K,
  SPINE_PAD,
  type FinPivot,
  type SpineParams,
} from "@/shared/aquarium/fish/spine";
import { bakeCreature } from "@/shared/aquarium/creatures/bake-creature";
import { initV2SwimState, stepV2Swim, Z_MAX, type V2WanderBox } from "@/shared/aquarium/sim/swim";
import { SPECIES_LIST } from "@/shared/creature/catalog";
import { COLOR_DEFS, getColorDef } from "@/shared/fish/catalog";
import { SWIM_SPEED } from "@/shared/constants/tank";
import { flattenPath } from "@/shared/lib/path2d";
import { wrapToPi } from "@/shared/lib/swim-model";
import type { BodyId, DorsalId, FishTraits, TailId } from "@/shared/fish/types";
import { FilterMode, MipmapMode, TileMode } from "@shopify/react-native-skia/src/skia/types";

/**
 * How many `phase` samples the injectivity/round-trip sweep uses per combo.
 * The bend's curvature peaks at different phases depending on trait geometry
 * (a sailfin's tallest point isn't necessarily where a round tail's is), so a
 * single fixed phase — as this check used to sample — silently missed the
 * true worst case. 24 samples is a full beat at 15° resolution.
 */
const SPINE_PHASE_SAMPLES = 24;

/**
 * Honest injectivity ceiling. Earlier versions of this check used a *guessed*
 * `nMax` (`halfHeight * 1.5`, capped at 60) instead of the real bake bounds,
 * and sampled one phase — which under-reported the true worst case by ~2x.
 *
 * 0.65 (35% margin before the fold point at 1.0) is the real number once
 * fins are sized against a fixed reference height (see anatomy.ts's
 * `FIN_REF_HALF_HEIGHT`) rather than each body's own. Measured worst case
 * for the original-silhouette body/fins: standard tops out at ~0.46
 * (round/sailfin), balloon — naturally deeper (halfHeight ~38 vs standard's
 * ~28.5) — at ~0.60 (round/sailfin). Shrinking fins further to force a
 * smaller number would undercut the reason this rework exists — a dorsal
 * fin has to be tall enough to read as a fin. Don't lower this without
 * re-measuring; don't raise it without checking the fold margin stays
 * comfortable.
 *
 * Re-measured after "update 2d fish v2" plan Part D (leaner `standard`
 * body, longer `lyretail`): `standard`'s own worst case actually DROPPED
 * (leaning the body out shrinks `nMax` faster than the bigger lyretail
 * grows it) — `balloon` is untouched by Part D and stays the tightest combo
 * at ~0.627 (`balloon/round/sailfin`), still comfortably under this ceiling
 * but worth watching before growing any `balloon` fin further.
 */
const INJECTIVITY_BUDGET_MAX = 0.65;

/**
 * Round-trip tolerance for the forward/inverse warp maps. 2 unrolled Newton
 * iterations (see spine.ts) converge tightly at typical slopes but leave a
 * larger residual at the largest `nMax` values real fins reach — up to
 * ~0.27px for `balloon/round/sailfin` (nMax=90, the deepest body x tallest
 * dorsal combination in the original-silhouette redesign) — still far below
 * anything visible on screen (a fraction of a device pixel even at 3x DPR),
 * so this is generous on purpose rather than chasing sub-pixel precision
 * that has no visual consequence. Re-measure, don't guess, if body/fin
 * proportions change again.
 *
 * Raised from 0.35 to 1.0 once the turn-bend term (`bendAmp`, "update 2d
 * fish v2" plan Part C) started composing with the same warp: stacking the
 * wave's own worst phase with the bend's worst sign at `balloon/round/
 * sailfin`'s `nMax` measured ~0.83px residual — still under 1 local unit
 * (a fraction of a device pixel at typical 2.5-3x bake DPR), so still no
 * visible consequence, but the compounded worst case needed the tolerance
 * re-measured rather than assumed. Re-measure again before raising
 * `TURN_BEND_GAIN_PX_PER_RAD` (`render/fish-layer.tsx`).
 */
const ROUND_TRIP_TOLERANCE_PX = 1.0;

/**
 * Fold-safety floor for `finSecondaryInjectivityBudget`'s worst-case
 * Jacobian determinant — must stay comfortably above 0 (where the rotation
 * field folds). Measured worst case across all 8 body/tail/dorsal
 * combinations at `PEC_FIN_AMP_MAX`/`CAUDAL_FIN_AMP_MAX`: 0.907 (pecNear,
 * constant across combos since pectoral geometry doesn't depend on
 * tail/dorsal). 0.5 leaves a comfortable ~45% margin below that — re-measure
 * before raising `PEC_FIN_AMP_MAX`/`CAUDAL_FIN_AMP_MAX` or shrinking a fin's
 * falloff-radius margin (`fin-secondary.ts`'s `FALLOFF_MARGIN`).
 */
const FIN_SECONDARY_DET_MIN = 0.5;

/**
 * `TURN_BEND_GAIN_PX_PER_RAD * ROLL_MAX` — the worst-case static turn-bend
 * amplitude (`render/fish-layer.tsx` / `sim/swim.ts`), duplicated as a
 * literal for the same "fails loudly if the source changes" reason as
 * `INJECTIVITY_BUDGET_MAX`'s neighbors. Swept with both signs below, since
 * `mirrorSign` means either sign is reachable depending on facing.
 */
const TURN_BEND_MAX = 8 * 0.65;

const BODIES: BodyId[] = ["standard", "balloon"];
const TAILS: TailId[] = ["round", "lyretail"];
const DORSALS: DorsalId[] = ["standard", "sailfin"];

/**
 * The art direction (see `body-profile.ts`'s header), made checkable:
 * `aspect = length / maxDepth` — legacy standard measured 2.48:1 under this
 * convention; this renderer's own original body targets are deliberately
 * stubbier/rounder. Don't loosen these to make a new table pass — fix the
 * table, the bounds encode the actual design brief.
 */
const PROPORTION_SPEC: Record<BodyId, { aspect: [number, number] }> = {
  // Widened from [1.85, 2.1] — "update 2d fish v2" plan Part D leaned
  // `standard` out toward the reference image (measured 2.273 after the
  // depth scale in body-profile.ts).
  standard: { aspect: [2.15, 2.4] },
  balloon: { aspect: [1.15, 1.45] },
};

let failures = 0;
function check(name: string, pass: boolean, detail?: string): void {
  const status = pass ? "PASS" : "FAIL";
  console.log(`[${status}] ${name}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failures++;
}

async function main() {
  const Skia = await loadSkiaNode();

  // 1. Anatomy invariants, over all 8 body/tail/dorsal combinations. Fins
  // are now separate shapes (see fins.ts's header for why), so the old
  // "topH+botH > 0" check went tautological the moment fins left the
  // outline — both curves are just the finless PCHIP base now, positive by
  // construction. These five replace it with checks that actually encode
  // what the fin rework is supposed to guarantee.
  console.log("\n-- Anatomy invariants --");
  for (const body of BODIES) {
    for (const tail of TAILS) {
      for (const dorsal of DORSALS) {
        const traits: FishTraits = { color: "goldDust", body, tail, dorsal };
        const anatomy = buildFishAnatomy(traits);
        const label = `${body}/${tail}/${dorsal}`;

        // (1) Peduncle exists: the body must actually narrow at the tail
        // base, not stay barrel-shaped — this is the exact thing that was
        // wrong with the fish before the fin rework (a lumpy silhouette
        // with no waist for a caudal fin to attach to).
        let maxDepth = 0;
        for (const u of linspace(0, 1, 200)) {
          maxDepth = Math.max(maxDepth, bodyDepthAt(anatomy.baseTop, anatomy.baseBottom, u));
        }
        const peduncleDepth = bodyDepthAt(anatomy.baseTop, anatomy.baseBottom, 1);
        const peduncleRatio = peduncleDepth / maxDepth;
        check(
          `${label} has a narrow peduncle (ratio 0.22-0.45)`,
          peduncleRatio >= 0.22 && peduncleRatio <= 0.45,
          `peduncle/max depth = ${peduncleRatio.toFixed(3)}`,
        );

        // (2) Body outline is a simple (non-self-intersecting) polygon.
        const bodyPoly = flattenPath(anatomy.outlineD, { tolerance: 0.6 })[0];
        check(
          `${label} body outline is simple`,
          !polygonSelfIntersects(bodyPoly),
          `${bodyPoly.length} points`,
        );

        // (2b) The unified body+tail ink-line path ("update 2d fish v2"
        // plan, Part A — see anatomy.ts's `silhouetteStrokeD`) must also be
        // simple. This is the harder case: unlike the body outline or a
        // single fin polygon, this path is stitched together from three
        // different curve families at the peduncle join — the body's own
        // PCHIP passes, two hand-tuned bridge Beziers, and the caudal fin's
        // own bulge-curve margin — and lyretail's concave forked margin is
        // the shape most likely to fold across a bridge.
        const strokePoly = flattenPath(anatomy.silhouetteStrokeD, { tolerance: 0.6 })[0];
        check(
          `${label} unified body+tail silhouette stroke is simple`,
          !polygonSelfIntersects(strokePoly),
          `${strokePoly.length} points`,
        );

        // (3) Every fin polygon is simple too — the fan builder's real risk
        // is a large negative bulge (the lyretail fork) folding the margin
        // over itself.
        const fins = Object.entries(anatomy.fins) as [string, FinShape][];
        for (const [name, fin] of fins) {
          const finPoly = flattenPath(fin.d, { tolerance: 0.4 })[0];
          check(`${label} ${name} fin polygon is simple`, !polygonSelfIntersects(finPoly));
        }

        // (4) Every "sunk" fin hub (dorsal/anal/pelvic — the ones the buried-
        // root trick applies to) is genuinely inside the body by ~its `sink`
        // value, so the opaque skin fill actually buries the seam for every
        // trait combination instead of relying on hand-tuning.
        const sunkFins: [string, FinShape, number][] = [
          ["dorsal", anatomy.fins.dorsal, 7],
          ["anal", anatomy.fins.anal, 6],
          ["pelvicNear", anatomy.fins.pelvicNear, 4],
          ["pelvicFar", anatomy.fins.pelvicFar, 4],
        ];
        for (const [name, fin, expectedSink] of sunkFins) {
          const inside = pointInPolygon(fin.pivot, bodyPoly);
          const dist = distanceToPolygonBoundary(fin.pivot, bodyPoly);
          check(
            `${label} ${name} hub buried ~${expectedSink}u inside the body`,
            inside && Math.abs(dist - expectedSink) < 3,
            `inside=${inside} distance=${dist.toFixed(1)} expected~${expectedSink}`,
          );
        }

        // (5) Every fin's median tip reaches clearly outside the body — the
        // opposite failure mode: a fin so short or so deeply sunk it never
        // shows at all.
        for (const [name, fin] of fins) {
          const outside = !pointInPolygon(fin.tip, bodyPoly);
          const dist = distanceToPolygonBoundary(fin.tip, bodyPoly);
          check(
            `${label} ${name} tip reaches >=8u outside the body`,
            outside && dist >= 8,
            `outside=${outside} distance=${dist.toFixed(1)}`,
          );
        }
      }
    }
  }

  // 2. Body proportions — the art direction (an original silhouette, not
  // fit to the legacy renderer's shape) made checkable, same spirit as the
  // scene-composition section's rule-of-thirds/asymmetry assertions below.
  // Encodes the design brief so a future edit can't silently drift the body
  // back toward something else without a failing check.
  console.log("\n-- Body proportions (art direction) --");
  for (const body of BODIES) {
    const { top, bottom, length } = BODY_PROFILES[body];
    const baseTop = pchip(top);
    const baseBottom = pchip(bottom);
    const spec = PROPORTION_SPEC[body];

    let maxDepth = 0;
    let crestU = 0;
    let bellyU = 0;
    let bestTop = -Infinity;
    let bestBottom = -Infinity;
    for (const u of linspace(0, 1, 400)) {
      const depth = bodyDepthAt(baseTop, baseBottom, u);
      maxDepth = Math.max(maxDepth, depth);
      if (baseTop(u) > bestTop) {
        bestTop = baseTop(u);
        crestU = u;
      }
      if (baseBottom(u) > bestBottom) {
        bestBottom = baseBottom(u);
        bellyU = u;
      }
    }
    const aspect = length / maxDepth;
    const snoutBluntness = bodyDepthAt(baseTop, baseBottom, 0) / maxDepth;
    const peduncleMidY = (baseBottom(1) - baseTop(1)) / 2;

    check(
      `${body} aspect (length/depth) in [${spec.aspect[0]}, ${spec.aspect[1]}]`,
      aspect >= spec.aspect[0] && aspect <= spec.aspect[1],
      `aspect=${aspect.toFixed(2)}`,
    );
    check(
      `${body} crest forward of centre (u in [0.32, 0.48])`,
      crestU >= 0.32 && crestU <= 0.48,
      `crest u=${crestU.toFixed(2)}`,
    );
    check(
      `${body} belly past centre (u in [0.50, 0.64])`,
      bellyU >= 0.5 && bellyU <= 0.64,
      `belly u=${bellyU.toFixed(2)}`,
    );
    check(
      `${body} blunt snout (depth(0)/maxDepth >= 0.24)`,
      snoutBluntness >= 0.24,
      `ratio=${snoutBluntness.toFixed(2)}`,
    );
    check(
      `${body} on-axis peduncle (|peduncleMidY| <= 2.5)`,
      Math.abs(peduncleMidY) <= 2.5,
      `peduncleMidY=${peduncleMidY.toFixed(2)}`,
    );
    check(
      `${body} top/bottom curves strictly positive on [0,1]`,
      linspace(0, 1, 200).every((u) => baseTop(u) > 0 && baseBottom(u) > 0),
    );
  }

  // 3. Every color bakes to a real, appropriately-sized image (a real Skia
  // bake, not a mock) — catches a dropped pattern branch or a paint that
  // throws for a specific palette (e.g. zebra's all-white / electricBlue's
  // all-black palettes, the same regression verify-fish-3d.ts guards against
  // on the 3D side).
  console.log("\n-- Fish bake, all 16 colors --");
  const dpr = densityAwareDpr(2, 1.15);
  let totalBytes = 0;
  const start = Date.now();
  for (const def of COLOR_DEFS) {
    const traits: FishTraits = {
      color: def.id,
      body: "standard",
      tail: "round",
      dorsal: "standard",
    };
    const baked = bakeFish(Skia, traits, "adult", dpr);
    const bytes = baked ? baked.image.width() * baked.image.height() * 4 : 0;
    totalBytes += bytes;
    check(
      `${def.id} bakes to a non-empty image`,
      !!baked && baked.image.width() > 0 && baked.image.height() > 0,
      baked
        ? `${baked.image.width()}x${baked.image.height()} (${(bytes / 1024).toFixed(0)}KB)`
        : "bake returned null",
    );
  }
  const elapsedMs = Date.now() - start;
  check(
    "16-fish bake budget (< 20MB total, matching the halved single-layer budget)",
    totalBytes < 20 * 1024 * 1024,
    `${(totalBytes / 1024 / 1024).toFixed(1)}MB`,
  );
  // This times CanvasKit's WASM software rasterizer under Node, not native
  // GPU-backed Skia — it is a regression smoke signal (did baking suddenly
  // get 10x slower), not a device performance budget. The real budget check
  // belongs on hardware (see the plan's Phase 0 device spike); don't compare
  // this number to verify-fish-3d.ts's native-GPU 120ms figure.
  check(
    "bake throughput sane (< 500ms/fish average under Node/CanvasKit)",
    elapsedMs / COLOR_DEFS.length < 500,
    `${elapsedMs}ms for ${COLOR_DEFS.length} fish (${(elapsedMs / COLOR_DEFS.length).toFixed(0)}ms/fish)`,
  );

  // 4. Every anatomy combination bakes too — cross-checks geometry x pigment
  // together, not just each dimension alone. Also checks the bake bounds
  // (used as the shader's draw rect) fully contain every fin's bbox — a fin
  // reaching outside its own fish's bake bounds would clip in the padded
  // warp quad.
  console.log("\n-- Fish bake, all anatomy combinations --");
  for (const body of BODIES) {
    for (const tail of TAILS) {
      for (const dorsal of DORSALS) {
        const traits: FishTraits = { color: "goldDust", body, tail, dorsal };
        const baked = bakeFish(Skia, traits, "adult", dpr);
        check(`${body}/${tail}/${dorsal} bakes`, !!baked);

        const def = getColorDef(traits.color);
        const spec = buildFishAquariumSpec(traits, def);
        for (const [name, fin] of Object.entries(spec.anatomy.fins)) {
          check(
            `${body}/${tail}/${dorsal} ${name} fin bbox within bake bounds`,
            boxContainsBox(spec.bounds, fin.bbox),
          );
        }
      }
    }
  }

  // 5. Life stages all bake (egg/fry/juvenile/adult squish factors).
  console.log("\n-- Life stages --");
  for (const stage of ["egg", "fry", "juvenile", "adult"] as const) {
    const baked = bakeFish(
      Skia,
      { color: "goldDust", body: "standard", tail: "round", dorsal: "standard" },
      stage,
      dpr,
    );
    check(`${stage} bakes`, !!baked);
  }

  // 6. Spine warp: round-trip, injectivity, and padding — the invariants
  // that keep the swim-bend shader from tearing, folding, or clipping.
  //
  // `nMax`/`boundsWidth`/`boundsX` come from the REAL bake bounds
  // (`buildFishAquariumSpec`), not an estimate — a fin can reach further
  // from the spine than any formula guesses, and the whole point of this
  // check is to catch that before it ships. The injectivity budget is
  // swept across a full beat (`SPINE_PHASE_SAMPLES` phases): the bend's
  // curvature peaks at different phases for different trait geometry, so a
  // single fixed phase silently misses the true worst case.
  console.log("\n-- Spine warp math --");
  for (const body of BODIES) {
    for (const tail of TAILS) {
      for (const dorsal of DORSALS) {
        const traits: FishTraits = { color: "goldDust", body, tail, dorsal };
        const def = getColorDef(traits.color);
        const { bounds } = buildFishAquariumSpec(traits, def);
        const nMax = Math.max(Math.abs(bounds.y), Math.abs(bounds.y + bounds.height));
        const boundsWidth = bounds.width;
        const boundsX = bounds.x;

        let maxErr = 0;
        let worstBudget = 0;
        // Sweeps both signs of the static turn-bend term alongside phase —
        // it's non-oscillating (unlike ampScale), so the true worst case is
        // wherever it lands ON TOP of the wave's own worst phase, and
        // `mirrorSign` means either sign is physically reachable.
        for (const bendAmp of [0, TURN_BEND_MAX, -TURN_BEND_MAX]) {
          for (let pi = 0; pi < SPINE_PHASE_SAMPLES; pi++) {
            const phase = (pi / SPINE_PHASE_SAMPLES) * Math.PI * 2;
            const p: SpineParams = {
              boundsX,
              boundsWidth,
              ampScale: SPINE_AMP_MAX,
              k: SPINE_K,
              phase,
              bendAmp,
            };
            for (let i = 0; i <= 20; i++) {
              const x = boundsX + (boundsWidth * i) / 20;
              for (const n of [-nMax, 0, nMax]) {
                const fwd = forwardWarp(x, n, p);
                const inv = inverseWarp(fwd.x, fwd.y, p);
                maxErr = Math.max(maxErr, Math.abs(inv.x - x), Math.abs(inv.n - n));
              }
            }
            worstBudget = Math.max(worstBudget, spineInjectivityBudget(p, nMax));
          }
        }
        check(
          `${body}/${tail}/${dorsal} forward/inverse round-trip < ${ROUND_TRIP_TOLERANCE_PX}px`,
          maxErr < ROUND_TRIP_TOLERANCE_PX,
          `max error ${maxErr.toFixed(4)}px`,
        );

        check(
          `${body}/${tail}/${dorsal} injectivity budget < ${INJECTIVITY_BUDGET_MAX} (no fold)`,
          worstBudget < INJECTIVITY_BUDGET_MAX,
          `budget=${worstBudget.toFixed(3)} at nMax=${nMax.toFixed(0)} (real bake bounds, ${SPINE_PHASE_SAMPLES}-phase sweep)`,
        );

        const maxDisp = Math.max(
          spineMaxDisplacement(boundsX, boundsWidth, SPINE_AMP_MAX, nMax, 60, TURN_BEND_MAX),
          spineMaxDisplacement(boundsX, boundsWidth, SPINE_AMP_MAX, nMax, 60, -TURN_BEND_MAX),
        );

        // Fin secondary motion (pectoral near/far scull, caudal lag — see
        // fish/spine.ts's finSecondaryOffset) composes AFTER this base warp,
        // so its own fold-safety and padding demands are checked here
        // against the SAME real bake geometry, not estimated separately.
        const anatomy = buildFishAnatomy(traits);
        const pivots = finPivotsFor(anatomy.fins);
        const finTargets: [string, FinPivot, number][] = [
          ["pecNear", pivots.pecNear, PEC_FIN_AMP_MAX],
          ["pecFar", pivots.pecFar, PEC_FIN_AMP_MAX],
          ["caudal", pivots.caudal, CAUDAL_FIN_AMP_MAX],
        ];
        let finMaxDisp = 0;
        for (const [finName, pivot, ampMax] of finTargets) {
          const finBudget = finSecondaryInjectivityBudget(pivot, ampMax);
          check(
            `${body}/${tail}/${dorsal} ${finName} secondary rotation stays injective (det > ${FIN_SECONDARY_DET_MIN})`,
            finBudget > FIN_SECONDARY_DET_MIN,
            `min det=${finBudget.toFixed(3)} at amp=${ampMax.toFixed(2)}rad, radius=(${pivot.radiusX.toFixed(1)},${pivot.radiusN.toFixed(1)})`,
          );
          finMaxDisp = Math.max(finMaxDisp, finSecondaryMaxDisplacement(pivot, ampMax));
        }

        check(
          `${body}/${tail}/${dorsal} SPINE_PAD (${SPINE_PAD}) covers base+bend + fin-secondary max displacement`,
          maxDisp + finMaxDisp < SPINE_PAD,
          `base+bend=${maxDisp.toFixed(1)}px + fin=${finMaxDisp.toFixed(1)}px = ${(maxDisp + finMaxDisp).toFixed(1)}px`,
        );
      }
    }
  }

  // 7. Shader/TS agreement: warp a synthetic image whose pixels ENCODE their
  // own coordinates, read back what the compiled SkSL actually sampled at
  // several destination points, and compare against the pure-TS inverse —
  // the check that proves the two formulas can't silently drift apart.
  console.log("\n-- Shader vs TS agreement --");
  const effect = getWarpEffect(Skia);
  check("warp effect compiles", !!effect);
  if (effect) {
    const srcW = 128;
    const srcH = 64;
    const srcSurf = Skia.Surface.Make(srcW, srcH)!;
    const sc = srcSurf.getCanvas();
    for (let px = 0; px < srcW; px++) {
      for (let py = 0; py < srcH; py++) {
        const paint = Skia.Paint();
        paint.setColor(Skia.Color(`rgb(${px},${Math.round((py / srcH) * 255)},128)`));
        sc.drawRect(Skia.XYWHRect(px, py, 1, 1), paint);
      }
    }
    const srcImage = srcSurf.makeImageSnapshot();
    const childShader = srcImage.makeShaderOptions(
      TileMode.Decal,
      TileMode.Decal,
      FilterMode.Nearest,
      MipmapMode.None,
    );

    const p: SpineParams = {
      boundsX: 0,
      boundsWidth: srcW,
      ampScale: 10,
      k: SPINE_K,
      phase: 0.7,
      bendAmp: 3,
    };
    // Synthetic (not real-geometry) pivots inside the srcW x srcH test
    // image, just to exercise finSecondaryOffset's SkSL twin against three
    // simultaneously-active fins with different signs/amplitudes — real
    // pivot placement is covered by the fold-safety sweep above instead.
    const pecNearPivot: FinPivot = { x: 40, n: 20, radiusX: 15, radiusN: 12 };
    const pecFarPivot: FinPivot = { x: 70, n: 45, radiusX: 15, radiusN: 12 };
    const caudalPivot: FinPivot = { x: 100, n: 32, radiusX: 20, radiusN: 18 };
    const pecNearAmp = 0.2;
    const pecFarAmp = -0.15;
    const caudalAmp = 0.1;
    const uniforms = {
      boundsX: p.boundsX,
      boundsWidth: p.boundsWidth,
      ampScale: p.ampScale,
      k: p.k,
      phase: p.phase,
      bendAmp: p.bendAmp ?? 0,
      pecNearHub: [pecNearPivot.x, pecNearPivot.n, pecNearPivot.radiusX, pecNearPivot.radiusN],
      pecFarHub: [pecFarPivot.x, pecFarPivot.n, pecFarPivot.radiusX, pecFarPivot.radiusN],
      caudalHub: [caudalPivot.x, caudalPivot.n, caudalPivot.radiusX, caudalPivot.radiusN],
      pecNearAmp,
      pecFarAmp,
      caudalAmp,
    };
    const warpShader = effect.makeShaderWithChildren(
      WARP_UNIFORM_KEYS.flatMap((key) => uniforms[key as keyof typeof uniforms]),
      [childShader],
    );
    const pad = 30;
    const outSurf = Skia.Surface.Make(srcW + pad * 2, srcH + pad * 2)!;
    const oc = outSurf.getCanvas();
    oc.translate(pad, pad);
    const outPaint = Skia.Paint();
    outPaint.setShader(warpShader);
    oc.drawRect(Skia.XYWHRect(-pad, -pad, srcW + pad * 2, srcH + pad * 2), outPaint);
    const outImage = outSurf.makeImageSnapshot();

    let maxAgreementErr = 0;
    let sampleCount = 0;
    for (let qx = 10; qx < srcW - 10; qx += 11) {
      for (let qy = 5; qy < srcH - 5; qy += 7) {
        const px = outImage.readPixels(qx + pad, qy + pad) as Uint8Array | null;
        if (!px || px[3] === 0) continue; // outside the warped silhouette (decal)
        const decodedX = px[0];
        const decodedY = (px[1] / 255) * srcH;
        const inv = inverseWarp(qx, qy, p);
        // The shader applies fin secondary rotations AFTER the base inverse
        // solve, in pecNear -> pecFar -> caudal order (see warp.ts's
        // main()) — compose the TS reference the same way, or this would
        // silently only be checking the base warp again.
        let expected = finSecondaryOffset(inv.x, inv.n, pecNearPivot, pecNearAmp);
        expected = finSecondaryOffset(expected.x, expected.n, pecFarPivot, pecFarAmp);
        expected = finSecondaryOffset(expected.x, expected.n, caudalPivot, caudalAmp);
        const err = Math.max(Math.abs(decodedX - expected.x), Math.abs(decodedY - expected.n));
        maxAgreementErr = Math.max(maxAgreementErr, err);
        sampleCount++;
      }
    }
    check(
      `shader sampling matches TS inverseWarp + finSecondaryOffset (${sampleCount} points, nearest-filter tolerance)`,
      maxAgreementErr < 1.5,
      `max disagreement ${maxAgreementErr.toFixed(2)}px across ${sampleCount} points`,
    );
  }

  // 8. Scene composition. The old check summed each piece's bbox WIDTH
  // across the swim lane — a thin leaning driftwood trunk registers its
  // whole canopy span as blocked even though almost all of that span is
  // open water around a narrow silhouette. This bakes the real mid/front
  // decor (same `bakeNodes` path `render/decor-cache.ts` uses) onto one
  // canvas-sized surface at its placed world position and reads back actual
  // pixel coverage per column — the true "how tall does decor reach here",
  // not an approximation of it.
  console.log("\n-- Scene composition --");
  {
    const ALPHA_THRESHOLD = 20; // ignore antialiased fringe, not real coverage
    const SAMPLE_STEP = 3;

    /** Per-3px-column "how high does decor reach here", as a fraction of the water column height. */
    function occupancyRaster(
      Skia: Awaited<ReturnType<typeof loadSkiaNode>>,
      pieces: PlacedPiece[],
      canvasWidth: number,
      substrateY: number,
    ): number[] {
      const nodes: Node[] = pieces.map((piece) => {
        const attachTo =
          piece.attachAngleDeg !== undefined
            ? { x: 0, y: 0, angleDeg: piece.attachAngleDeg }
            : undefined;
        const generated = GENERATORS[piece.species]({
          seed: piece.seed,
          scale: piece.scale,
          attachTo,
          mirror: piece.mirror,
        });
        return {
          kind: "group" as const,
          children: generated.nodes,
          transform: { translateX: piece.worldX, translateY: piece.worldY },
        };
      });
      const bounds: Box = { x: 0, y: 0, width: canvasWidth, height: substrateY };
      const baked = bakeNodes(Skia, nodes, bounds, 1);
      const occ: number[] = [];
      if (!baked) return occ;
      const w = Math.ceil(bounds.width);
      const h = Math.ceil(bounds.height);
      const px = baked.image.readPixels() as Uint8Array | null;
      if (!px) return occ;
      for (let x = 0; x < w; x += SAMPLE_STEP) {
        let topRow = h;
        for (let y = 0; y < h; y++) {
          if (px[(y * w + x) * 4 + 3] > ALPHA_THRESHOLD) {
            topRow = y;
            break;
          }
        }
        occ.push((h - topRow) / h);
      }
      return occ;
    }

    for (const [w, h] of [
      [390, 844],
      [430, 932],
      [844, 390],
    ] as const) {
      const substrateY = h - 60;
      const scene = composeScene(NATURE_SCAPE, w, h, substrateY);
      check(
        `${w}x${h}: theme produces pieces`,
        scene.pieces.length > 0,
        `${scene.pieces.length} pieces`,
      );

      // Back-layer decor doesn't count toward any of these — it reads as
      // background, not an obstacle (same exemption the old check made).
      const midFront = scene.pieces.filter((p) => p.layer !== "back");
      const mid = scene.pieces.filter((p) => p.layer === "mid");
      const occAll = occupancyRaster(Skia, midFront, w, substrateY);
      const occMid = occupancyRaster(Skia, mid, w, substrateY);

      // Corridor: most of the width should stay clearly open, echoing the
      // authored `swimLanes` without hard-coding trust in it.
      const meanOcc = occAll.reduce((a, b) => a + b, 0) / occAll.length;
      check(
        `${w}x${h}: mean decor occupancy < 45% of the water column`,
        meanOcc < 0.45,
        `${(meanOcc * 100).toFixed(1)}%`,
      );
      const fracLow = occAll.filter((v) => v < 0.25).length / occAll.length;
      check(
        `${w}x${h}: >=40% of columns have a genuine corridor (occupancy < 25%)`,
        fracLow >= 0.4,
        `${(fracLow * 100).toFixed(1)}% of columns`,
      );

      // Spaciousness: the user's original "smaller fish, roomier tank"
      // request, made checkable on the decor side too — real occupied
      // area (height-integrated over sampled columns), not summed bboxes.
      const occupiedArea = occAll.reduce((a, b) => a + b * substrateY * SAMPLE_STEP, 0);
      const spaciousness = occupiedArea / (w * h);
      check(
        `${w}x${h}: mid+front occupied area < 45% of canvas`,
        spaciousness < 0.45,
        `${(spaciousness * 100).toFixed(1)}%`,
      );

      // Focal point on a rule-of-thirds line: the tallest MID-layer reach
      // (the driftwood canopy's apex, by design) shouldn't sit dead centre
      // and should land near a third. Tolerance is wider than a naive 0.06
      // — measured apex position ranges from 0.30 near-square/portrait down
      // to ~0.24 on a short landscape canvas, where `sizeFactorFor`'s
      // height clamp (see compose.ts) pulls the whole cluster in.
      let apexIdx = 0;
      let apexVal = -1;
      occMid.forEach((v, i) => {
        if (v > apexVal) {
          apexVal = v;
          apexIdx = i;
        }
      });
      const apexX = (apexIdx * SAMPLE_STEP) / w;
      const nearestThird = Math.abs(apexX - 1 / 3) <= Math.abs(apexX - 2 / 3) ? 1 / 3 : 2 / 3;
      check(
        `${w}x${h}: focal apex (x=${apexX.toFixed(3)}) within 0.10 of a third`,
        Math.abs(apexX - nearestThird) <= 0.1,
        `nearest third=${nearestThird.toFixed(3)}`,
      );
      check(`${w}x${h}: focal apex not centred (>0.12 from x=0.5)`, Math.abs(apexX - 0.5) > 0.12);

      // Asymmetry: the left cluster should read as clearly heavier than the
      // right one (by design — see nature-scape.ts's header), not a
      // mirrored pair.
      let leftArea = 0;
      let rightArea = 0;
      occAll.forEach((v, i) => {
        const x = i * SAMPLE_STEP;
        const area = v * substrateY * SAMPLE_STEP;
        if (x < w / 2) leftArea += area;
        else rightArea += area;
      });
      const asymmetry = leftArea / rightArea;
      check(
        `${w}x${h}: left/right decor weight ratio in [1.3, 2.6]`,
        asymmetry >= 1.3 && asymmetry <= 2.6,
        `ratio=${asymmetry.toFixed(2)}`,
      );
    }
  }

  // 9. Swim trace (2D V2 renderer's steering) — pure math, no Skia, no React.
  // `sim/swim.ts` has no Reanimated/UI-thread dependency beyond the
  // `"worklet"` directives (harmless outside a worklet context), so it
  // traces exactly like the real per-frame stepping will, just driven by a
  // seeded PRNG instead of a device clock. Physical invariants (bounds,
  // turn-rate limiting, the edge-on width floor's sign) must hold on EVERY
  // seed; the art/feel properties (edge-on time, reversal rate, forward
  // progress) are inherently statistical — seed-to-seed spread of roughly
  // 7%-16% edge-on time was measured directly while tuning BROADSIDE_BIAS —
  // so those assert on the mean across seeds, not on every individual one.
  console.log("\n-- Swim trace (2D V2 steering) --");
  {
    const box: V2WanderBox = { minX: 40, maxX: 350, minY: 60, maxY: 500 };
    const DT = 1 / 60;
    const DURATION_S = 60;
    const STEPS = Math.round(DURATION_S / DT);
    const SEEDS = 20;
    // The steering law's own ceiling (`TURN_RATE_BURST` in sim/swim.ts) —
    // duplicated here as a literal rather than imported so this check fails
    // loudly if the source ceiling ever changes without this trace being
    // re-examined, instead of silently tracking a moving target.
    const TURN_RATE_CEIL = 3.0;
    const EDGE_ON_MIN_WIDTH = 0.3;
    // Duplicated from sim/swim.ts / render/fish-layer.tsx for the same
    // "fails loudly if the source changes without this trace being
    // re-examined" reason as TURN_RATE_CEIL above ("update 2d fish v2"
    // plan, Part C).
    const TURN_RATE_MIN = 1.5;
    const ARC_GAIN_PX_PER_RAD = 30;
    /** Screen-px threshold below which the wall-turn arc wouldn't read as visible. */
    const ARC_VISIBLE_PX = 8;

    function mulberry32(seed: number): () => number {
      let a = seed;
      return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    /**
     * Straightness index = net displacement / path length over a window.
     * Swimming-kinematics reference band for real cruising fish is 0.35-0.75:
     * below ~0.15 the fish is circling (the classic symptom of a steering bug
     * where a persistent heading-relative offset acts as a constant turn),
     * above ~0.9 it's on rails. Measured over 5s windows, which is long
     * enough to span a retarget but short enough that a legitimate slow
     * wander doesn't average itself out to zero.
     */
    const STRAIGHTNESS_WINDOW_S = 5;
    const STRAIGHTNESS_WINDOW_STEPS = Math.round(STRAIGHTNESS_WINDOW_S / DT);

    interface TraceResult {
      anyNaN: boolean;
      anyOutOfBounds: boolean;
      anyTurnRateViolation: boolean;
      anyWSignCross: boolean;
      meanEdgeOnPct: number;
      meanReversalsPerMin: number;
      meanAbsVx: number;
      meanStraightness: number;
      turningArcVisibleFrac: number;
    }

    function runTrace(currentStrength: number): TraceResult {
      let anyNaN = false;
      let anyOutOfBounds = false;
      let anyTurnRateViolation = false;
      let anyWSignCross = false;
      let edgeOnFracSum = 0;
      let reversalsPerMinSum = 0;
      let meanAbsVxSum = 0;
      let straightnessSum = 0;
      let straightnessWindows = 0;
      let turningSteps = 0;
      let turningVisibleSteps = 0;

      for (let seedIdx = 0; seedIdx < SEEDS; seedIdx++) {
        const seed = seedIdx / SEEDS;
        const rand = mulberry32(1000 + seedIdx);
        const state = initV2SwimState(box, seed);
        const seedPhase = seed * Math.PI * 2;

        let prevYaw = state.yaw;
        let prevCosSign = Math.sign(Math.cos(state.yaw)) || 1;
        let prevX = state.x;
        let reversals = 0;
        let edgeOnSteps = 0;
        let vxAbsSum = 0;
        // Straightness is measured in the (x,y) SCREEN plane, not (x,z) —
        // it's "does the visible path wander or circle", and z is a steering
        // variable the viewer never sees directly.
        let winStartX = state.x;
        let winStartY = state.y;
        let winPathLen = 0;
        let winPrevX = state.x;
        let winPrevY = state.y;

        for (let i = 0; i < STEPS; i++) {
          stepV2Swim(state, box, DT, 1, seedPhase, rand, currentStrength);

          if (
            !Number.isFinite(state.x) ||
            !Number.isFinite(state.y) ||
            !Number.isFinite(state.z) ||
            !Number.isFinite(state.yaw)
          ) {
            anyNaN = true;
          }
          if (
            state.x < box.minX - 1 ||
            state.x > box.maxX + 1 ||
            state.y < box.minY - 1 ||
            state.y > box.maxY + 1 ||
            Math.abs(state.z) > Z_MAX + 1
          ) {
            anyOutOfBounds = true;
          }

          // A `wrapToPi` sign bug (this exact bug bit an earlier draft of this
          // trace's probe script, not sim/swim.ts itself) shows up here as a
          // jump far past what the turn-rate ceiling allows.
          const dYaw = Math.abs(wrapToPi(state.yaw - prevYaw));
          if (dYaw > TURN_RATE_CEIL * DT + 1e-3) anyTurnRateViolation = true;
          prevYaw = state.yaw;

          const cosYaw = Math.cos(state.yaw);
          const cosSign = Math.sign(cosYaw) || prevCosSign;
          if (cosSign !== prevCosSign) reversals++;
          prevCosSign = cosSign;

          if (Math.abs(cosYaw) < EDGE_ON_MIN_WIDTH) edgeOnSteps++;
          const w = -cosSign * Math.max(Math.abs(cosYaw), EDGE_ON_MIN_WIDTH);
          if (w === 0) anyWSignCross = true;

          vxAbsSum += Math.abs(state.x - prevX) / DT;
          prevX = state.x;

          // Visible wall-turn arc: while actively turning (turnRate above
          // the baseline cruise-arc rate), does the render-layer's
          // roll-driven `arcOffset` reach a visible magnitude? Mirrors
          // `fish-layer.tsx`'s `arcOffset = roll * ARC_GAIN_PX_PER_RAD`
          // exactly — this is pure math on `state.roll`, no Skia needed.
          if (Math.abs(state.turnRate) > TURN_RATE_MIN) {
            turningSteps++;
            if (Math.abs(state.roll * ARC_GAIN_PX_PER_RAD) > ARC_VISIBLE_PX) turningVisibleSteps++;
          }

          winPathLen += Math.hypot(state.x - winPrevX, state.y - winPrevY);
          winPrevX = state.x;
          winPrevY = state.y;
          if ((i + 1) % STRAIGHTNESS_WINDOW_STEPS === 0) {
            if (winPathLen > 1) {
              straightnessSum += Math.hypot(state.x - winStartX, state.y - winStartY) / winPathLen;
              straightnessWindows++;
            }
            winStartX = state.x;
            winStartY = state.y;
            winPathLen = 0;
          }
        }

        edgeOnFracSum += edgeOnSteps / STEPS;
        reversalsPerMinSum += reversals / (DURATION_S / 60);
        meanAbsVxSum += vxAbsSum / STEPS;
      }

      return {
        anyNaN,
        anyOutOfBounds,
        anyTurnRateViolation,
        anyWSignCross,
        meanEdgeOnPct: (edgeOnFracSum / SEEDS) * 100,
        meanReversalsPerMin: reversalsPerMinSum / SEEDS,
        meanAbsVx: meanAbsVxSum / SEEDS,
        meanStraightness: straightnessWindows > 0 ? straightnessSum / straightnessWindows : 0,
        turningArcVisibleFrac: turningSteps > 0 ? turningVisibleSteps / turningSteps : 0,
      };
    }

    // Both the default (creature species: no shared current) and molly's
    // opted-in current strength — the current blends `yawDesired`, so it can
    // in principle break the turn-rate/bounds guarantees, and "we only
    // eyeballed the new path" is exactly how that regresses silently.
    const cruiseFloor = 0.45 * SWIM_SPEED;
    for (const { label, strength } of [
      { label: "current off", strength: 0 },
      { label: "current on", strength: 1 },
    ]) {
      const r = runTrace(strength);
      const tag = `swim trace [${label}]`;
      check(`${tag}: no NaN/Infinity over ${SEEDS} seeds x ${DURATION_S}s`, !r.anyNaN);
      check(`${tag}: x/y/z stay within box/±Z_MAX (1px slack)`, !r.anyOutOfBounds);
      check(`${tag}: yaw never exceeds the turn-rate ceiling in one step`, !r.anyTurnRateViolation);
      check(`${tag}: edge-on width floor \`w\` never crosses zero`, !r.anyWSignCross);
      check(
        `${tag}: mean edge-on time (|cos yaw| < 0.3) < 15% across seeds`,
        r.meanEdgeOnPct < 15,
        `${r.meanEdgeOnPct.toFixed(1)}%`,
      );
      check(
        `${tag}: mean >= 6 heading reversals/min (the fish actually turns around)`,
        r.meanReversalsPerMin >= 6,
        `${r.meanReversalsPerMin.toFixed(1)}/min`,
      );
      check(
        `${tag}: mean |screen-x speed| > 0.45x cruise across seeds`,
        r.meanAbsVx > cruiseFloor,
        `${r.meanAbsVx.toFixed(1)}px/s vs floor ${cruiseFloor.toFixed(1)}px/s`,
      );
      check(
        `${tag}: straightness index in the natural 0.35-0.75 band`,
        r.meanStraightness >= 0.35 && r.meanStraightness <= 0.75,
        `${r.meanStraightness.toFixed(2)} (<0.15 = circling, >0.9 = on rails)`,
      );
      check(
        `${tag}: wall-turns produce a visible (>${ARC_VISIBLE_PX}px) on-screen arc most of the time`,
        r.turningArcVisibleFrac > 0.5,
        `${(r.turningArcVisibleFrac * 100).toFixed(0)}% of actively-turning steps (|turnRate| > ${TURN_RATE_MIN}) exceed the visibility threshold`,
      );
    }
  }

  // 9. Creature bakes — every non-molly species x variant, through
  // `creatures/bake-creature.ts`'s dispatcher (real anatomy where it's
  // shipped, the placeholder blob otherwise), so a species graduating from
  // one to the other is covered automatically with no change here. A loose
  // sanity check (bakes, non-degenerate, not runaway-sized) rather than a
  // per-body-plan invariant like the fish anatomy checks above — a shell's
  // "is this polygon valid" bar is different from a fin's, and each real
  // per-species build can add its own tighter check alongside its module.
  console.log("\n-- Creature bakes --");
  for (const def of SPECIES_LIST) {
    if (def.id === "molly") continue;
    for (const variant of def.variants) {
      const baked = bakeCreature(Skia, def.id, variant.id, 2);
      check(`${def.id}/${variant.id} bakes`, baked !== null);
      if (!baked) continue;
      const { width, height } = baked.bounds;
      check(
        `${def.id}/${variant.id} bounds are sane`,
        width > 1 && height > 1 && width < 400 && height < 400,
        `${width.toFixed(1)}x${height.toFixed(1)}`,
      );
    }
  }

  console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) failed.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
