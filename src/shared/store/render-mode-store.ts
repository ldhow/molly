import Storage from "expo-sqlite/kv-store";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type RenderMode = "2d" | "3d";

interface RenderModeStore {
  renderMode: RenderMode;
  setRenderMode: (mode: RenderMode) => void;
}

/**
 * Same synchronous kv-store adapter as session-store.ts — cheap enough for a
 * one-field preference that it doesn't need its own justification beyond
 * "stay consistent with the pattern already in this codebase."
 */
const syncKvStorage = {
  getItem: (name: string) => Storage.getItemSync(name),
  setItem: (name: string, value: string) => Storage.setItemSync(name, value),
  removeItem: (name: string) => Storage.removeItemSync(name),
};

/** 2D stays the shipped default; 3D is opt-in via the toggle on the Tank screen. */
export const useRenderModeStore = create<RenderModeStore>()(
  persist(
    (set) => ({
      renderMode: "2d",
      setRenderMode: (mode) => set({ renderMode: mode }),
    }),
    {
      name: "renderMode",
      version: 1,
      storage: createJSONStorage(() => syncKvStorage),
    },
  ),
);
