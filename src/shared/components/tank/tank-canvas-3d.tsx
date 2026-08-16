// The 3D counterpart to the 2D V2 renderer — same external prop shape
// (drop-in via tank-view.tsx), real geometry instead of Skia sprites.
//
// This file has four `useFrame` call sites (TankScene, Water, Decor, and one
// each inside Fish3D/DeadFish3D in fish-3d.tsx). There is no single "tick"
// function here: R3F calls every mounted component's `useFrame` callback once
// per rendered frame, in the order those components mounted, and each
// callback owns only the piece of the scene it built. That's why Water only
// touches sand/particles and Decor only touches plants/bubbles — reading one
// `useFrame` in isolation tells you everything it does; you never need to
// trace a shared loop to find out what runs before or after it.
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import type * as THREE from "three";

import type { WanderBox } from "@/shared/lib/swim-model";
import type { MollyTankFish } from "@/shared/lib/tank-fish";

import { DeadFish3D, Fish3D } from "./fish-3d";
import { pumpSkinQueue } from "./fish-skin-texture";
import {
  createBubbles,
  createDriftwood,
  createPlants,
  createRocks,
  type DecorPiece,
} from "./tank-decor-3d";
import {
  createBackdrop,
  createParticles,
  createSand,
  type Particles,
  type SandFloor,
} from "./tank-env-3d";
import { DEFAULT_TANK_DESIGN } from "./tank-design";
import { disposeTree } from "./three-dispose";

interface Props {
  fish: MollyTankFish[];
  /** "center": session mode — the single growing fish drifts near the middle. */
  mode?: "tank" | "center";
  style?: ViewStyle;
}

// Every constant in this scene comes from tank-design.ts. Nothing visual is
// authored here — that's what lets `yarn tank:design` preview the real thing
// and what keeps the browser demo from drifting away from the app.
const DESIGN = DEFAULT_TANK_DESIGN;
const FRAMING = DESIGN.scene.framing;

/** Camera→origin distance, which is what R3F's `viewport` is measured at. */
function cameraDistance(mode: "tank" | "center"): number {
  const [x, y, z] = DESIGN.scene.camera[mode].position;
  return Math.hypot(x, y, z);
}

export function TankCanvas3D({ fish, mode = "tank", style }: Props) {
  const [ready, setReady] = useState(false);
  const cam = DESIGN.scene.camera[mode];
  const { fog, lights, background } = DESIGN.scene;

  return (
    <View style={[styles.root, style]} onLayout={() => setReady(true)}>
      {ready ? (
        <Canvas
          style={StyleSheet.absoluteFill as never}
          camera={{
            position: [...cam.position],
            fov: DESIGN.scene.camera.fov,
            near: DESIGN.scene.camera.near,
            far: DESIGN.scene.camera.far,
          }}
          // R3F's default camera keeps identity rotation (staring down -Z), so
          // without this the tank sits below the frustum and the scene reads
          // as empty. The browser demo only avoided this because OrbitControls
          // set a look target for it.
          onCreated={(state) => state.camera.lookAt(cam.target[0], cam.target[1], cam.target[2])}
        >
          <color attach="background" args={[background]} />
          <fogExp2 attach="fog" args={[fog.color, fog.density]} />
          {/* A hemisphere light is the cheapest thing that reads as "under
              water": cool from the surface above, warm sand bounce below.
              It replaces the flat ambient entirely. */}
          <hemisphereLight
            args={[lights.hemisphere.sky, lights.hemisphere.ground, lights.hemisphere.intensity]}
          />
          <directionalLight
            color={lights.key.color}
            intensity={lights.key.intensity}
            position={[...lights.key.position]}
          />
          <directionalLight
            color={lights.fill.color}
            intensity={lights.fill.intensity}
            position={[...lights.fill.position]}
          />
          <TankScene fish={fish} mode={mode} />
        </Canvas>
      ) : null}
    </View>
  );
}

/**
 * Lives inside <Canvas> so it can read the real viewport and size the tank to
 * whatever aspect the device actually has — a fixed world-space box would put
 * fish off-screen on a portrait phone.
 */
function TankScene({ fish, mode }: { fish: MollyTankFish[]; mode: "tank" | "center" }) {
  const viewport = useThree((s) => s.viewport);

  // One skin bake per frame at most. Fish show their palette gradient until
  // their turn comes up, so a full tank fills in over a second or so instead
  // of blocking the JS thread on mount.
  useFrame(() => {
    pumpSkinQueue();
  });

  const spanZ = FRAMING.depthSpan[mode];
  // `viewport.width` is measured at the origin plane, but a perspective
  // frustum is NARROWER nearer the camera — a fish swimming to the front of
  // the tank would slide off-screen if we sized the box at the origin. Scale
  // down to the width available at the closest depth a fish can reach.
  const camDist = cameraDistance(mode);
  const usableWidth = Math.max(1.5, viewport.width * ((camDist - spanZ / 2) / camDist));

  // Fish size is pinned to the whole visible width, while the swim box is a
  // centred sub-region of it. Deriving both from one span would shrink the
  // fish whenever the roaming area shrank — which is exactly backwards for
  // "center" mode, where a small drift area should still show a big fish.
  const unitsPerPx = usableWidth / FRAMING.virtualWidth;

  const box = useMemo<WanderBox>(
    () => ({
      minX: 0,
      maxX: FRAMING.virtualWidth * FRAMING.widthFraction[mode],
      minY: 0,
      maxY: spanZ / (usableWidth / FRAMING.virtualWidth),
    }),
    [usableWidth, spanZ, mode],
  );

  const dead = fish.filter((f) => f.status === "dead");
  const alive = fish.filter((f) => f.status === "alive");

  return (
    <>
      <Water
        key={`w${Math.round(usableWidth * 4)}`}
        width={viewport.width * FRAMING.sandWidthMultiple}
        depth={spanZ * FRAMING.sandDepthMultiple}
        halfW={(usableWidth * FRAMING.widthFraction[mode]) / 2}
        halfD={spanZ / 2}
        topY={viewport.height / 2}
      />

      {mode === "tank" ? (
        <Decor
          // Remount when the visible width changes materially (orientation
          // change) so plants re-scatter to fit rather than clumping.
          key={Math.round(usableWidth * 4)}
          halfW={(usableWidth * FRAMING.widthFraction.tank) / 2}
          halfD={spanZ / 2}
          topY={viewport.height / 2}
        />
      ) : null}

      {dead.map((f) => (
        <DeadFish3D
          key={f.key}
          traits={f.traits}
          scale={f.scale}
          seed={f.seed}
          box={box}
          unitsPerPx={unitsPerPx}
        />
      ))}
      {alive.map((f) => (
        <Fish3D
          key={f.key}
          traits={f.traits}
          stage={f.stage}
          scale={f.scale}
          seed={f.seed}
          box={box}
          unitsPerPx={unitsPerPx}
          speedFactor={mode === "center" ? DESIGN.scene.centerSpeedFactor : 1}
        />
      ))}
    </>
  );
}

interface WaterRefs {
  sand: SandFloor;
  backdrop: THREE.Mesh;
  particles: Particles;
}

/** Sand, caustics, the backdrop sphere and suspended particulate. */
function Water({
  width,
  depth,
  halfW,
  halfD,
  topY,
}: {
  width: number;
  depth: number;
  halfW: number;
  halfD: number;
  topY: number;
}) {
  "use no memo";
  const ref = useRef<WaterRefs | null>(null);
  ref.current ??= {
    sand: createSand(width, depth),
    backdrop: createBackdrop(),
    particles: createParticles(
      DESIGN.water.particles.count,
      halfW * FRAMING.particleSpreadMultiple,
      halfD * FRAMING.particleSpreadMultiple,
      topY,
    ),
  };
  const water = ref.current;

  useEffect(() => {
    const built = ref.current;
    return () => {
      if (!built) return;
      disposeTree(built.sand.mesh);
      disposeTree(built.backdrop);
      disposeTree(built.particles.points);
    };
  }, []);

  // Drives the sand's scrolling caustic shimmer and the suspended-particle
  // drift. Nothing else in the water group animates (the backdrop is static).
  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    water.sand.update(t);
    water.particles.update(t, delta);
  });

  return (
    <>
      {/* eslint-disable-next-line react-hooks/refs -- <primitive> needs a stable object identity, which only a ref guarantees */}
      <primitive object={water.backdrop} />
      {/* eslint-disable-next-line react-hooks/refs -- as above */}
      <primitive object={water.sand.mesh} />
      {/* eslint-disable-next-line react-hooks/refs -- as above */}
      <primitive object={water.particles.points} />
    </>
  );
}

interface DecorRefs {
  plants: DecorPiece;
  bubbles: DecorPiece;
  rocks: THREE.Group;
  driftwood: THREE.Group;
}

/** Swaying seaweed, rising bubbles and a scatter of stones. */
function Decor({ halfW, halfD, topY }: { halfW: number; halfD: number; topY: number }) {
  "use no memo";
  const ref = useRef<DecorRefs | null>(null);
  ref.current ??= {
    plants: createPlants(DESIGN.decor.plants.count, halfW, halfD),
    bubbles: createBubbles(DESIGN.decor.bubbles.count, halfW, halfD, topY),
    rocks: createRocks(DESIGN.decor.rocks.count, halfW, halfD),
    driftwood: createDriftwood(halfW, halfD),
  };
  const decor = ref.current;

  // This component is keyed on the viewport width, so it remounts on every
  // orientation change — without disposal that leaks ~30 blade geometries
  // and their materials each time. Read the ref inside the effect: the decor
  // is built once per mount, so there is nothing to re-run on.
  useEffect(() => {
    const built = ref.current;
    return () => {
      if (!built) return;
      disposeTree(built.plants.group);
      disposeTree(built.bubbles.group);
      disposeTree(built.rocks);
      disposeTree(built.driftwood);
    };
  }, []);

  // Drives seaweed sway and bubble rise. Rocks and driftwood are static, so
  // they're built once above and never touched here.
  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    decor.plants.update(t, delta);
    decor.bubbles.update(t, delta);
  });

  return (
    <>
      {/* eslint-disable-next-line react-hooks/refs -- <primitive> needs a stable object identity, which only a ref guarantees */}
      <primitive object={decor.plants.group} />
      {/* eslint-disable-next-line react-hooks/refs -- as above */}
      <primitive object={decor.bubbles.group} />
      {/* eslint-disable-next-line react-hooks/refs -- as above */}
      <primitive object={decor.rocks} />
      {/* eslint-disable-next-line react-hooks/refs -- as above */}
      <primitive object={decor.driftwood} />
    </>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    overflow: "hidden",
  },
});
