import { FishLayer } from "@/shared/aquarium/render/fish-layer";
import { AquariumWater } from "@/shared/aquarium/render/water";
import { SceneLayer } from "@/shared/aquarium/scene/types";
import { MollyTankFish } from "@/shared/lib/tank-fish";
import { Canvas } from "@shopify/react-native-skia";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

function depthOf(seed: number): number {
  return (seed * 31.7) % 1;
}

/** Quantises the continuous depth cue into the three bands the scene interleaves with. */
function bandOf(depth: number): SceneLayer {
  if (depth < 1 / 3) return "back";
  if (depth < 2 / 3) return "mid";
  return "front";
}

type Bounds = { width: number; height: number };

function renderAlive(
  f: MollyTankFish & { depth: number; band: SceneLayer },
  bounds: Bounds,
  mode: "tank" | "center",
) {
  return (
    <FishLayer
      key={f.key}
      traits={f.traits}
      stage={f.stage}
      status="alive"
      bounds={bounds}
      scale={f.scale}
      seed={f.seed}
      mode={mode}
      depth={f.depth}
      band={f.band}
    />
  );
}

export function TestScreen() {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const mockFishes: MollyTankFish[] = [
    {
      speciesId: "molly",
      traits: {
        color: "shadowVeil",
        body: "balloon",
        tail: "lyretail",
        dorsal: "sailfin",

        patternSeed: 2,
      },
      key: "test",
      stage: "adult",
      status: "alive",
      scale: 1,
      seed: 1,
    },
    {
      speciesId: "molly",
      traits: {
        color: "sanke",
        body: "standard",
        tail: "round",
        dorsal: "sailfin",

        patternSeed: 2,
      },
      key: "test2",
      stage: "adult",
      status: "alive",
      scale: 1,
      seed: 1,
    },
  ];
  const alive = mockFishes
    .map((f) => ({ ...f, depth: depthOf(f.seed), band: bandOf(depthOf(f.seed)) }))
    .sort((a, b) => a.depth - b.depth);

  return (
    <View
      style={[styles.root]}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setSize({ width, height });
      }}
    >
      <Canvas style={[StyleSheet.absoluteFill]}>
        <AquariumWater width={size.width} height={size.height} />
        {alive.map((f) => renderAlive(f, size, "tank"))}
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    overflow: "hidden",
  },
});
