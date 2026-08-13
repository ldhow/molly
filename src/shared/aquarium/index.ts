// Public surface of the aquarium renderer. Consumers outside this tree
// should only ever import from here (or from `render/aquarium-canvas.tsx`
// directly, which `tank-view.tsx` does) — never reach into `core/`, `fish/`,
// or `scene/` from elsewhere in the app.
export { AquariumCanvas, type AquariumFish } from "./render/aquarium-canvas";
