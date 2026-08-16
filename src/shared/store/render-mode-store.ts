import Storage from "expo-sqlite/kv-store";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type RenderMode = "v2" | "3d";

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

/** 2D V2 is the shipped default; 3D is opt-in via the toggle on the Tank screen. */
export const useRenderModeStore = create<RenderModeStore>()(
  persist(
    (set) => ({
      renderMode: "v2",
      setRenderMode: (mode) => set({ renderMode: mode }),
    }),
    {
      name: "renderMode",
      version: 4,
      storage: createJSONStorage(() => syncKvStorage),
      // v1 only ever persisted "2d" | "3d". v2 added "flow" (this renderer's
      // old codename) — remap any persisted "flow" to "v2". v4 removed the
      // legacy 2D renderer entirely — remap any persisted "2d" to "v2" too,
      // so a device that had either the old default or the old codename
      // selected doesn't land on a value that no longer exists.
      migrate: (persisted) => {
        const store = persisted as RenderModeStore;
        if ((store.renderMode as string) === "flow" || (store.renderMode as string) === "2d") {
          return { ...store, renderMode: "v2" };
        }
        return store;
      },
    },
  ),
);
