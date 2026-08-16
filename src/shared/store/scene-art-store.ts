import Storage from "expo-sqlite/kv-store";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type SceneArtMode = "procedural" | "sprites";

interface SceneArtStore {
  sceneArtMode: SceneArtMode;
  setSceneArtMode: (mode: SceneArtMode) => void;
}

/** Same synchronous kv-store adapter as render-mode-store.ts — see that file's identical note. */
const syncKvStorage = {
  getItem: (name: string) => Storage.getItemSync(name),
  setItem: (name: string, value: string) => Storage.setItemSync(name, value),
  removeItem: (name: string) => Storage.removeItemSync(name),
};

/**
 * Which background art the 2D V2 tank draws: the generated decor
 * (`scene/gen/*`, always available) or shipped PNG sprites
 * (`scene/sprites/*`, only as good as the assets dropped into
 * `assets/images/scene/`). A dev-only A/B toggle, not a user-facing
 * preference — see the Tank screen's Scene button (`__DEV__`-gated).
 */
export const useSceneArtStore = create<SceneArtStore>()(
  persist(
    (set) => ({
      sceneArtMode: "procedural",
      setSceneArtMode: (mode) => set({ sceneArtMode: mode }),
    }),
    {
      name: "sceneArtMode",
      version: 1,
      storage: createJSONStorage(() => syncKvStorage),
    },
  ),
);
