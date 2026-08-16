import Storage from "expo-sqlite/kv-store";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { replaceRecipes, type BreedRecipe } from "@/shared/fish/generated-breed";

/** Same synchronous kv-store adapter as render-mode-store.ts — see that file's identical note. */
const syncKvStorage = {
  getItem: (name: string) => Storage.getItemSync(name),
  setItem: (name: string, value: string) => Storage.setItemSync(name, value),
  removeItem: (name: string) => Storage.removeItemSync(name),
};

interface GeneratedBreedsStore {
  /** Keyed by `gen:` id. */
  breeds: Record<string, BreedRecipe>;
  saveBreed: (recipe: BreedRecipe) => void;
  removeBreed: (id: string) => void;
  clearBreeds: () => void;
}

/**
 * Breeds the user has kept, stored as their FULL recipe rather than just the
 * seed.
 *
 * Regeneration alone would render any `gen:` id correctly today, so this looks
 * redundant — it isn't. The generator's tuning tables are meant to keep being
 * tuned, and a retune would silently repaint every previously-kept fish. The
 * stored recipe pins a breed's appearance at the moment it was kept, and
 * `generated-breed.ts`'s registry makes it win over regeneration. It also
 * leaves room for recipes that DIDN'T come from the generator (hand-edited, or
 * authored elsewhere), which a seed alone could never express.
 *
 * The registry rather than this store is what `catalog.ts` reads through,
 * because that module has to keep running under plain Node for the preview and
 * verify scripts — it can't import zustand or expo-sqlite. This file is the
 * bridge: every state change is mirrored across.
 */
export const useGeneratedBreedsStore = create<GeneratedBreedsStore>()(
  persist(
    (set) => ({
      breeds: {},
      saveBreed: (recipe) => set((state) => ({ breeds: { ...state.breeds, [recipe.id]: recipe } })),
      removeBreed: (id) =>
        set((state) => {
          const { [id]: _removed, ...rest } = state.breeds;
          return { breeds: rest };
        }),
      clearBreeds: () => set({ breeds: {} }),
    }),
    {
      name: "generatedBreeds",
      version: 1,
      storage: createJSONStorage(() => syncKvStorage),
    },
  ),
);

// The kv adapter is synchronous, so `persist` finishes hydrating during
// `create(...)` above — this initial mirror runs with the restored breeds
// already in state, and the registry is populated before the first render.
// Same reasoning as session-store.ts's cold-start note.
//
// It only runs once this MODULE is imported, though. Today the only importer
// is the dev breed lab, which is fine because nothing else renders a `gen:`
// breed yet. The moment one does — a session reward writing `gen:<seed>` into
// `sessions.color_id` — this store has to be imported from the root layout
// too, or a kept breed would silently fall back to regeneration.
const mirror = (state: GeneratedBreedsStore) => replaceRecipes(Object.values(state.breeds));
mirror(useGeneratedBreedsStore.getState());
useGeneratedBreedsStore.subscribe(mirror);
