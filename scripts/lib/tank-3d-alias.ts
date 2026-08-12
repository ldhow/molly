import { join } from "node:path";

/**
 * esbuild `alias` map for bundling browser code that imports the REAL 3D
 * tank components (tank-canvas-3d.tsx + fish-3d.tsx via @react-three/fiber)
 * outside Metro. A strict allowlist, not a wildcard `@/*` resolver, so an
 * unexpected import (e.g. `@/db/*` or Skia) fails loudly at the unresolved
 * specifier instead of deep inside some native module.
 *
 * Shared by every dev tool that mounts these components in a browser
 * (`tank:3d-react`, the 3D preview in `fish:colors`) so this allowlist has
 * exactly one copy to keep in sync as the production import graph changes.
 *
 * `libDir` is the caller's own `scripts/lib` — where expo-asset-shim.ts and
 * glb-require-stub.ts live.
 */
export function tank3dAlias(root: string, libDir: string): Record<string, string> {
  return {
    "react-native": require.resolve("react-native-web"),
    "expo-asset": join(libDir, "expo-asset-shim.ts"),
    "@/assets/models/short_molly.glb": join(libDir, "glb-require-stub.ts"),
    "@/shared/lib/swim-model": join(root, "src/shared/lib/swim-model.ts"),
    "@/shared/fish/catalog": join(root, "src/shared/fish/catalog.ts"),
    "@/shared/fish/glb-geometry": join(root, "src/shared/fish/glb-geometry.ts"),
    "@/shared/lib/color": join(root, "src/shared/lib/color.ts"),
    "@/shared/lib/rng": join(root, "src/shared/lib/rng.ts"),
    "@/shared/lib/seed": join(root, "src/shared/lib/seed.ts"),
    "@/shared/constants/tank": join(root, "src/shared/constants/tank.ts"),
    "@/shared/fish/skin-map": join(root, "src/shared/fish/skin-map.ts"),
    "@/shared/components/tank/tank-canvas-3d": join(
      root,
      "src/shared/components/tank/tank-canvas-3d.tsx",
    ),
    "@/shared/components/tank/tank-canvas": join(
      root,
      "src/shared/components/tank/tank-canvas.tsx",
    ),
    "@/shared/components/tank/fish-mesh-3d": join(
      root,
      "src/shared/components/tank/fish-mesh-3d.ts",
    ),
  };
}
