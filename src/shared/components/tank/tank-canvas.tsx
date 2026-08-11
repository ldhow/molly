import { Canvas } from "@shopify/react-native-skia";
import { useState } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";

import type { FishTraits, LifeStage } from "@/shared/fish/types";

import { FishSprite } from "./fish-sprite";
import { Bubbles } from "./bubbles";
import { Plants } from "./plants";
import { Sand, WaterBackground } from "./water-background";

export interface TankFish {
  key: string;
  traits: FishTraits;
  stage: LifeStage;
  status: "alive" | "dead";
  scale: number;
  seed: number;
}

interface Props {
  fish: TankFish[];
  /** "center": session mode — the single growing fish drifts near the middle. */
  mode?: "tank" | "center";
  style?: ViewStyle;
}

/** Deterministic [0,1) "how far back" a fish sits — same seed, different prime. */
function depthOf(seed: number): number {
  return (seed * 31.7) % 1;
}

export function TankCanvas({ fish, mode = "tank", style }: Props) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const dead = fish.filter((f) => f.status === "dead");
  // Far fish drawn first so nearer ones overlap them, smaller and fogged —
  // a cheap depth illusion with no per-fish blur or extra draw passes.
  const alive = fish
    .filter((f) => f.status === "alive")
    .map((f) => ({ ...f, depth: depthOf(f.seed) }))
    .sort((a, b) => a.depth - b.depth);

  return (
    <View
      style={[styles.root, style]}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setSize({ width, height });
      }}
    >
      {size.width > 0 && size.height > 0 ? (
        <Canvas style={StyleSheet.absoluteFill}>
          <WaterBackground width={size.width} height={size.height} />
          <Sand width={size.width} height={size.height} />
          <Plants width={size.width} height={size.height} />
          {dead.map((f) => (
            <FishSprite
              key={f.key}
              traits={f.traits}
              stage={f.stage}
              status="dead"
              bounds={size}
              scale={f.scale}
              seed={f.seed}
            />
          ))}
          {alive.map((f) => (
            <FishSprite
              key={f.key}
              traits={f.traits}
              stage={f.stage}
              status="alive"
              bounds={size}
              scale={f.scale}
              seed={f.seed}
              mode={mode}
              depth={f.depth}
            />
          ))}
          <Bubbles width={size.width} height={size.height} />
        </Canvas>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    overflow: "hidden",
  },
});
