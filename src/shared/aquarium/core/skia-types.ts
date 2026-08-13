// A type-only module: `Skia` is exported from `@shopify/react-native-skia`
// as a value only (no re-exported interface under that name), so the usual
// way to name "the whole Skia JS API" as a type is `typeof Skia`. Isolated
// here so every other file can `import type { SkiaApi }` — a type-only
// import that never pulls the native module into a Node script.
import { Skia } from "@shopify/react-native-skia";

export type SkiaApi = typeof Skia;
