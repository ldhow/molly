// Boots the REAL `@shopify/react-native-skia` JS API under plain Node, backed
// by CanvasKit (already a transitive dependency of react-native-skia) instead
// of a native JSI host object. `Skia.Path`, `Skia.Paint`, `Skia.Surface`,
// `Skia.RuntimeEffect`, canvas draw calls — all the same shapes the device
// runtime exposes, so `core/emit.ts` runs unmodified in both places.
//
// `require()`, not `import()`: the web entry's `export *` re-export loses its
// members across the ESM/CJS interop boundary under tsx, so `import()`
// resolves to an empty namespace. `require()` doesn't have that problem.
//
// Note this validates SkSL *semantics* (does it compile, does the math check
// out) against CanvasKit 0.41, not the exact native Skia build (2.6.2) the
// app ships. That gap is what a device spike is for — see the plan's Phase 0.

/* eslint-disable @typescript-eslint/no-require-imports */
import type { SkiaApi } from "@/shared/aquarium/core/skia-types";

let cached: SkiaApi | null = null;

export async function loadSkiaNode(): Promise<SkiaApi> {
  if (cached) return cached;
  const CanvasKitInit = require("canvaskit-wasm/bin/full/canvaskit.js");
  const { JsiSkApi } = require("@shopify/react-native-skia/src/skia/web");
  const CanvasKit = await CanvasKitInit({});
  cached = JsiSkApi(CanvasKit) as SkiaApi;
  return cached;
}
