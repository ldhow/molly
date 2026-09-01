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
 * Which background art the 2D V2 tank draws: shipped PNG sprites
 * (`scene/sprites/*`) — the shipped default, and the only mode the Decor
 * Store's items render in — or the generated decor (`scene/gen/*`), kept
 * around as a dev-only A/B comparison behind the Tank screen's Scene button
 * (`__DEV__`-gated).
 */
export const useSceneArtStore = create<SceneArtStore>()(
  persist(
    (set) => ({
      sceneArtMode: "sprites",
      setSceneArtMode: (mode) => set({ sceneArtMode: mode }),
    }),
    {
      name: "sceneArtMode",
      version: 2,
      storage: createJSONStorage(() => syncKvStorage),
      // v1 defaulted to "procedural" for everyone. v2 makes sprites the real,
      // shipped renderer (it's what the Decor Store's items draw), so any
      // device that persisted the old default gets moved onto sprites too —
      // only an explicit prior choice of "sprites" is left alone either way.
      migrate: () => ({ sceneArtMode: "sprites" }) as SceneArtStore,
    },
  ),
);
