// Public surface of the aquarium renderer. Consumers outside this tree
// should only ever import from here (or from `render/aquarium-canvas.tsx`
// directly, which `tank-view.tsx` does) — never reach into `core/`, `fish/`,
// or `scene/` from elsewhere in the app.
export { AquariumCanvas, type AquariumFish } from "./render/aquarium-canvas";

// The sprite decor manifest is plain, read-only DATA (not renderer internals)
// and was already a public contract for Node tooling (`scripts/verify-aquarium.ts`,
// `scripts/aquarium-design-editor.ts`) before this export existed. The Decor
// Store's catalogue (`@/shared/decor/catalog.ts`) is a priced VIEW over these
// same ids — re-exporting here is what lets it (and its `expo-image`
// thumbnails) reach the manifest without reaching past this tree's boundary.
export { SCENE_SPRITES, type SceneSprite, type SpriteId } from "./scene/sprites/sprite-manifest";
export { SPRITE_SOURCES } from "./scene/sprites/sprite-sources";

// `SpritePlacement`/`SpriteSceneTheme` are the shape `@/shared/decor/scape.ts`
// builds from owned+placed decor rows — re-exported so it can construct one
// without importing past this tree's boundary. Pure types, zero runtime cost.
//
// `composeSpriteScene`/`PlacedSprite` are exported too so the Decorate
// screen can run the SAME pure composition a second time to hit-test "which
// piece did this tap land on" (tap-to-select on the canvas) — it needs the
// exact `worldX`/`worldY`/`rect` `AquariumCanvas` itself draws from, not an
// approximation kept in sync by hand. Dependency-free, so this costs nothing
// to call outside the render path.
export {
  composeSpriteScene,
  type PlacedSprite,
  type SpritePlacement,
  type SpriteSceneTheme,
} from "./scene/compose-sprites";
