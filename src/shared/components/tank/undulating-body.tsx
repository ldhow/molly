// A traveling body wave over the baked fish texture, using a coarse Vertices
// mesh so the flat "everything but the tail" bake can still ripple. Positions
// are recomputed every frame on the UI thread; UVs are static, so nothing
// samples outside the source image — the mesh just rides the texture.
//
// The wave shares `waveDy` with the tail rotation in fish-sprite.tsx: same
// formula, same inputs, so the seam at the peduncle can never drift apart.
//
// Deliberately NOT `usePointBuffer`: in this Skia version the native SkPoint
// host object exports only getters for `x`/`y` (see cpp/api/JsiSkPoint.h —
// no JSI setter, and the base host-object `set()` silently no-ops when a
// property isn't in its setters map), so mutating a buffered point's fields
// in place is a no-op on device. Rebuilding the array with `Skia.Point()`
// each frame goes through the same constructor every other Skia call in this
// codebase already relies on, at the cost of 18 small allocations per fish
// per frame.
import {
  ImageShader,
  Skia,
  Vertices,
  type SkImage,
  type SkPoint,
} from "@shopify/react-native-skia";
import { useMemo } from "react";
import { useDerivedValue, type SharedValue } from "react-native-reanimated";

import type { Box } from "@/shared/fish/render-spec";
import { waveDy } from "@/shared/lib/swim-model";

const COLS = 9;
const ROWS = 2;

interface Props {
  image: SkImage;
  bounds: Box;
  beatPhase: SharedValue<number>;
  speedNorm: SharedValue<number>;
  phase: number;
}

/** Body texture rippled by a head→tail traveling wave. Image mode only. */
export function UndulatingBody({ image, bounds, beatPhase, speedNorm, phase }: Props) {
  const textures = useMemo(() => {
    const tex: SkPoint[] = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const u = c / (COLS - 1);
        tex.push(Skia.Point(bounds.x + u * bounds.width, bounds.y + r * bounds.height));
      }
    }
    return tex;
  }, [bounds]);

  const indices = useMemo(() => {
    const idx: number[] = [];
    for (let c = 0; c < COLS - 1; c++) {
      idx.push(c, c + 1, COLS + c);
      idx.push(c + 1, COLS + c + 1, COLS + c);
    }
    return idx;
  }, []);

  const vertices = useDerivedValue<SkPoint[]>(() => {
    const pts: SkPoint[] = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const u = c / (COLS - 1);
        const dy = waveDy(u, beatPhase.value, speedNorm.value, phase);
        pts.push(Skia.Point(bounds.x + u * bounds.width, bounds.y + r * bounds.height + dy));
      }
    }
    return pts;
  });

  const rect = useMemo(
    () => Skia.XYWHRect(bounds.x, bounds.y, bounds.width, bounds.height),
    [bounds],
  );

  return (
    <Vertices vertices={vertices} textures={textures} indices={indices} mode="triangles">
      <ImageShader image={image} rect={rect} fit="fill" />
    </Vertices>
  );
}
