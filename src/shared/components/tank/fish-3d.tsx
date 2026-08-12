// R3F wrappers around the shared 3D fish mesh (fish-mesh-3d.ts). Thin by
// design: all the geometry/art lives in the mesh factory, all the physics
// lives in swim-model.ts — this file only owns per-frame orientation, the
// pixel→world projection, and mounting the imperative three.js object into
// R3F's declarative tree via the `<primitive>` escape hatch.
//
// Why the swim model still runs in PIXELS here: every constant in
// swim-model.ts is tuned in screen pixels (SWIM_SPEED 55px/s, ARRIVE_RADIUS
// 26px, WALL_MARGIN 60/40px). Handing it a box measured in world units would
// make a fish cross a ~5-unit tank in a fifth of a second and count as
// permanently "arrived" and "against a wall". So the caller passes a virtual
// pixel-space box, the model runs in the units it was tuned for, and the
// result is projected to world space by `unitsPerPx`.
import { useFrame } from "@react-three/fiber";
import { Asset } from "expo-asset";
import { useEffect, useRef } from "react";
import * as THREE from "three";

import { getColorDef } from "@/shared/fish/catalog";
import type { FishTraits, LifeStage } from "@/shared/fish/types";
import {
  initSwimState,
  MAX_DT,
  stepSwim,
  type SwimState,
  type WanderBox,
} from "@/shared/lib/swim-model";

import {
  bankFor,
  bobFor,
  createFishMesh,
  createGlbFishMesh,
  desaturatePalette,
  FISH_PX_LENGTH,
  MESH_LENGTH,
  yawFor,
  type FishMesh3D,
  type FishPalette,
} from "./fish-mesh-3d";
import { requestSkin } from "./fish-skin-texture";
import { GROUND_Y } from "./tank-decor-3d";
import { DEFAULT_TANK_DESIGN } from "./tank-design";

// ---------------------------------------------------------------------------
// The imported model's bytes are loaded once and shared by every fish for the
// process lifetime — the file never changes, so there's nothing to
// invalidate. `expo-asset`'s documented contract (Asset.fromModule +
// downloadAsync → localUri) resolves a bundled require() to a fetchable URI;
// `fetch` on that local URI works the same as any other in RN.
// ---------------------------------------------------------------------------
let glbBytesCache: ArrayBuffer | null = null;
let glbBytesPromise: Promise<ArrayBuffer> | null = null;

function loadGlbBytes(): Promise<ArrayBuffer> {
  if (glbBytesCache) return Promise.resolve(glbBytesCache);
  glbBytesPromise ??= (async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Metro needs a static require to resolve the bundled asset
    const asset = Asset.fromModule(require("@/assets/models/short_molly.glb"));
    await asset.downloadAsync();
    const res = await fetch(asset.localUri ?? asset.uri);
    const bytes = await res.arrayBuffer();
    glbBytesCache = bytes;
    return bytes;
  })();
  return glbBytesPromise;
}

/**
 * Mount cheap, upgrade when ready — the same philosophy `requestSkin`
 * already uses for the albedo bake, one level up: every fish starts as the
 * procedural mesh (synchronous, always available) and swaps to the imported
 * model in place once its one-time download resolves. After the first fish
 * in a session, `glbBytesCache` is warm and every later mount goes straight
 * to the model with no swap at all.
 */
function buildInitialFish(palette: FishPalette, traits: FishTraits): FishMesh3D {
  if (DEFAULT_TANK_DESIGN.fish.useGlbModel && glbBytesCache) {
    return createGlbFishMesh(palette, { bytes: glbBytesCache });
  }
  return createFishMesh(palette, { tail: traits.tail, dorsal: traits.dorsal });
}

/** Small helper so the group.add side effect can live inside a `??=` lazy-init expression. */
function addToGroup(fish: FishMesh3D, group: THREE.Group): FishMesh3D {
  group.add(fish.group);
  return fish;
}

/**
 * Runs once per mount: if this fish started on the procedural fallback
 * because the model wasn't downloaded yet, swaps to the model in place once
 * it is; then (live fish only) requests the patterned skin bake. `group` is
 * a stable wrapper whose children get swapped, not the `<primitive>` target
 * itself, matching this file's existing preference for imperative mutation
 * over state-driven re-renders.
 *
 * `wantsSkin` is false for dead fish: they were never patterned before this
 * change either — `DeadFish3D` only ever used the flat desaturated vertex
 * gradient, and requesting a skin bake here would replace that grayscale
 * with the fish's full living colour, undoing the point of `desaturatePalette`.
 */
function useFishUpgrade(
  group: THREE.Group,
  fishRef: { current: FishMesh3D | null },
  palette: FishPalette,
  traits: FishTraits,
  def: ReturnType<typeof getColorDef>,
  wantsSkin: boolean,
) {
  useEffect(() => {
    let cancelled = false;
    let cancelSkin: (() => void) | undefined;

    async function upgrade() {
      if (DEFAULT_TANK_DESIGN.fish.useGlbModel && !glbBytesCache) {
        const bytes = await loadGlbBytes();
        if (cancelled) return; // cleanup already disposed the procedural fallback
        const old = fishRef.current;
        if (old) {
          group.remove(old.group);
          old.dispose();
        }
        const glb = createGlbFishMesh(palette, { bytes });
        group.add(glb.group);
        fishRef.current = glb;
      }
      if (cancelled || !wantsSkin) return; // cleanup will dispose whatever fishRef.current now is
      cancelSkin = requestSkin(traits, def, (skin) => fishRef.current?.setSkin(skin.texture));
    }
    upgrade();

    return () => {
      cancelled = true;
      cancelSkin?.();
      fishRef.current?.dispose();
      fishRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- built once per mount, matching the refs above
  }, []);
}

interface Fish3DProps {
  traits: FishTraits;
  stage: LifeStage;
  /**
   * Final render scale (life stage × any session growth) — same contract and
   * same value as the 2D FishSprite's `scale`, already stage-adjusted by the
   * caller, so it must NOT be multiplied by STAGE_SCALE again here.
   */
  scale: number;
  /** Stable per-fish value in [0,1). */
  seed: number;
  /** Swim bounds in virtual pixel space (see file header). */
  box: WanderBox;
  /** World units per virtual pixel. */
  unitsPerPx: number;
  speedFactor?: number;
}

/**
 * One live, swimming 3D fish. The mesh and swim state are lazily-initialized
 * refs because `useFrame` mutates the three.js object every frame — imperative
 * mutation is how R3F is meant to be driven, and there's no declarative
 * alternative. That collides with the React Compiler (on project-wide via
 * app.json), so this component opts itself out with the sanctioned
 * per-function directive rather than disabling the compiler repo-wide.
 */
export function Fish3D({
  traits,
  stage,
  scale,
  seed,
  box,
  unitsPerPx,
  speedFactor = 1,
}: Fish3DProps) {
  "use no memo";
  const fishRef = useRef<FishMesh3D | null>(null);
  const groupRef = useRef<THREE.Group | null>(null);
  const stateRef = useRef<SwimState | null>(null);
  const phaseRef = useRef(seed * Math.PI * 2);
  const def = getColorDef(traits.color);
  // A stable wrapper: `<primitive>` binds to this once and never again, so
  // the fish mesh underneath it can be swapped in place (procedural →
  // imported model, once its one-time download resolves) without needing a
  // re-render to re-bind the primitive to a new object. `??=` is the
  // sanctioned lazy-init-once idiom the compiler/lint rule already accepts
  // (see MESH_LENGTH-adjacent refs below); wrapping the group.add side
  // effect in `addToGroup()` keeps it inside that same single expression.
  groupRef.current ??= new THREE.Group();
  fishRef.current ??= addToGroup(buildInitialFish(def.palette, traits), groupRef.current);
  stateRef.current ??= initSwimState(box, seed);

  // R3F never disposes a `<primitive>` payload — without this, every fish that
  // leaves the tank leaks its geometry and materials.
  // eslint-disable-next-line react-hooks/refs -- groupRef.current was just guaranteed non-null above
  useFishUpgrade(groupRef.current, fishRef, def.palette, traits, def, true);

  // Per-frame sequence, in order: (1) advance the shared swim physics one
  // tick (same stepSwim used by the 2D renderer, just fed a delta from R3F's
  // clock instead of Reanimated's); (2) translate the resulting pixel-space
  // x/y into this fish's world-space transform; (3) hand the new beat phase
  // to the mesh so it can pose its own vertices (body wave, tail sweep, fin
  // flutter — see fish-mesh-3d.ts). Nothing here is declarative state, so
  // none of this triggers a React re-render; it's a straight imperative walk
  // executed by R3F once per rendered frame.
  useFrame((_, delta) => {
    const fish = fishRef.current;
    const group = groupRef.current;
    if (!fish || !group) return;
    const s = stateRef.current!;
    const phase = phaseRef.current;
    stepSwim(s, box, Math.min(delta, MAX_DT), speedFactor, phase, Math.random);

    // Position/rotation belong on the wrapper, not `fish.group`: the wrapper
    // also carries `worldScale` (below), and a child's position is composed
    // through its parent's scale — setting these on `fish.group` instead
    // would silently scale the swim position a second time.
    const cx = (box.minX + box.maxX) / 2;
    const cy = (box.minY + box.maxY) / 2;
    group.position.set(
      (s.x - cx) * unitsPerPx,
      bobFor(performance.now(), phase),
      (s.y - cy) * unitsPerPx,
    );
    group.rotation.y = yawFor(s.theta);
    group.rotation.z = bankFor(s.facingRight, s.turnRate);
    fish.update(s.beatPhase, s.speedNorm, phase);
  });

  // `stage` is already folded into `scale` by the caller — see the prop doc.
  const worldScale = (scale * FISH_PX_LENGTH * unitsPerPx) / MESH_LENGTH;

  // R3F's <primitive> needs a stable object identity at render time, which is
  // exactly what a ref provides and a memo does not guarantee under the
  // compiler's assumptions.
  // eslint-disable-next-line react-hooks/refs -- deliberate: see comment above
  return <primitive object={groupRef.current} scale={worldScale} />;
}

interface DeadFish3DProps {
  traits: FishTraits;
  scale: number;
  seed: number;
  /** Swim bounds in virtual pixel space, used only to scatter the corpse. */
  box: WanderBox;
  unitsPerPx: number;
}

/** A static, desaturated corpse resting belly-up on the sand — no swim loop. */
export function DeadFish3D({ traits, scale, seed, box, unitsPerPx }: DeadFish3DProps) {
  "use no memo";
  const fishRef = useRef<FishMesh3D | null>(null);
  const groupRef = useRef<THREE.Group | null>(null);
  const def = getColorDef(traits.color);
  const palette = desaturatePalette(def.palette);
  // Same stable-wrapper swap pattern as Fish3D, for the same reason: the
  // model download is async but `<primitive>` needs a synchronous, never-
  // changing object identity.
  groupRef.current ??= new THREE.Group();
  // update() is deliberately never called: the mesh stays at its as-built
  // rest pose (no body wave, no tail or fin motion) — the 3D equivalent of
  // the 2D dead-fish branch always passing clock={null}.
  fishRef.current ??= addToGroup(buildInitialFish(palette, traits), groupRef.current);

  // eslint-disable-next-line react-hooks/refs -- groupRef.current was just guaranteed non-null above
  useFishUpgrade(groupRef.current, fishRef, palette, traits, def, false);

  const spanX = (box.maxX - box.minX) * unitsPerPx;
  const spanZ = (box.maxY - box.minY) * unitsPerPx;
  const x = ((seed * 9973) % 1) * spanX - spanX / 2;
  const z = ((seed * 7331) % 1) * spanZ - spanZ / 2;
  const worldScale = (scale * FISH_PX_LENGTH * unitsPerPx) / MESH_LENGTH;

  return (
    <primitive
      // eslint-disable-next-line react-hooks/refs -- deliberate: see Fish3D's identical pattern above
      object={groupRef.current}
      position={[x, GROUND_Y + 0.12, z]}
      rotation={[Math.PI, (seed - 0.5) * Math.PI * 2, (seed - 0.5) * 0.4]}
      scale={worldScale}
    />
  );
}
