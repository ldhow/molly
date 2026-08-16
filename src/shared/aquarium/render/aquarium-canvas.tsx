// Drop-in replacement for `@/shared/components/tank/tank-canvas.tsx`'s
// `TankCanvas` — same `{ fish, mode, style }` props — so `tank-view.tsx` can
// switch to this renderer with a third branch and every existing consumer
// (Tank screen, session screen's `mode="center"`, the result sheet) keeps
// working unchanged. This is the ONE renderer that receives the full
// `AnyTankFish[]` (molly AND the 5 new species) — see `tank-view.tsx`'s
// header for why the other two renderers only ever see molly.
//
// Dispatches each individual to `FishLayer` (molly) or `CreatureLayer`
// (every other species) via `isMollyTankFish`'s discriminant — both layers
// share the exact same swim engine and depth-band interleave, so a mixed
// tank reads as one scene, not two overlaid ones.

import { Canvas } from "@shopify/react-native-skia";
import { useMemo, useState } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";

import { sandHeightFor } from "@/shared/constants/tank";
import { isMollyTankFish, type AnyTankFish, type MollyTankFish } from "@/shared/lib/tank-fish";

import { composeScene, type PlacedPiece } from "../scene/compose";
import { NATURE_SCAPE } from "../scene/themes/nature-scape";
import type { SceneLayer } from "../scene/types";
import { AquariumBubbles } from "./bubbles";
import { CreatureLayer } from "./creature-layer";
import { FishLayer } from "./fish-layer";
import { SceneLayerGroup } from "./scene-layers";
import { AquariumSubstrate, AquariumWater } from "./water";

export type AquariumFish = MollyTankFish;

interface Props {
  fish: AnyTankFish[];
  mode?: "tank" | "center";
  style?: ViewStyle;
}

/** Deterministic [0,1) "how far back" a fish sits — same rule as tank-canvas.tsx. */
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

/** Dispatches one individual to `FishLayer` (molly) or `CreatureLayer` (everything else) — the one place that needs to know both layers exist. */
function renderDead(f: AnyTankFish, bounds: Bounds) {
  return isMollyTankFish(f) ? (
    <FishLayer
      key={f.key}
      traits={f.traits}
      stage={f.stage}
      status="dead"
      bounds={bounds}
      scale={f.scale}
      seed={f.seed}
    />
  ) : (
    <CreatureLayer
      key={f.key}
      speciesId={f.speciesId}
      variant={f.variant}
      status="dead"
      bounds={bounds}
      scale={f.scale}
      seed={f.seed}
    />
  );
}

function renderAlive(
  f: AnyTankFish & { depth: number; band: SceneLayer },
  bounds: Bounds,
  mode: "tank" | "center",
) {
  return isMollyTankFish(f) ? (
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
  ) : (
    <CreatureLayer
      key={f.key}
      speciesId={f.speciesId}
      variant={f.variant}
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

export function AquariumCanvas({ fish, mode = "tank", style }: Props) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const dead = fish.filter((f) => f.status === "dead");
  const alive = fish
    .filter((f) => f.status === "alive")
    .map((f) => ({ ...f, depth: depthOf(f.seed), band: bandOf(depthOf(f.seed)) }))
    .sort((a, b) => a.depth - b.depth);

  const substrateY = size.height - sandHeightFor(size.height);
  const scene = useMemo(
    () =>
      size.width > 0 && size.height > 0
        ? composeScene(NATURE_SCAPE, size.width, size.height, substrateY)
        : null,
    [size.width, size.height, substrateY],
  );
  const piecesByLayer = useMemo(() => {
    const grouped: Record<SceneLayer, PlacedPiece[]> = { back: [], mid: [], front: [] };
    for (const piece of scene?.pieces ?? []) grouped[piece.layer].push(piece);
    return grouped;
  }, [scene]);

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
          <AquariumWater width={size.width} height={size.height} />
          <AquariumSubstrate width={size.width} height={size.height} />
          {dead.map((f) => renderDead(f, size))}
          <SceneLayerGroup pieces={piecesByLayer.back} />
          {alive.filter((f) => f.band === "back").map((f) => renderAlive(f, size, mode))}
          <SceneLayerGroup pieces={piecesByLayer.mid} />
          {alive.filter((f) => f.band === "mid").map((f) => renderAlive(f, size, mode))}
          <SceneLayerGroup pieces={piecesByLayer.front} />
          {alive.filter((f) => f.band === "front").map((f) => renderAlive(f, size, mode))}
          <AquariumBubbles width={size.width} height={size.height} />
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
