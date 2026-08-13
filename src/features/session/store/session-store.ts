import Storage from "expo-sqlite/kv-store";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { createId } from "@/shared/lib/id";

import type {
  ActiveSession,
  CreatureSelection,
  RolledCreature,
  SessionOutcome,
  SessionResult,
} from "../types";

interface SessionStore {
  /** Persisted — the snapshot that survives app kill. */
  active: ActiveSession | null;
  /** In-memory — drives the result sheet after a session ends. */
  result: SessionResult | null;
  /** In-memory — true right after surviving the grace period ("phew"). */
  graceRecovered: boolean;

  start: (selection: CreatureSelection, plannedMinutes: number) => ActiveSession;
  markBackgrounded: (now: number) => void;
  clearBackgrounded: () => void;
  /** Clears the active session and records the result (variant/traits already rolled). */
  finish: (outcome: SessionOutcome, endedAt: number, rolled: RolledCreature) => void;
  acknowledgeResult: () => void;
  setGraceRecovered: (value: boolean) => void;
}

/**
 * Synchronous kv-store adapter: hydration happens during store creation, so
 * cold-start judgment never races against async rehydration.
 */
const syncKvStorage = {
  getItem: (name: string) => Storage.getItemSync(name),
  setItem: (name: string, value: string) => Storage.setItemSync(name, value),
  removeItem: (name: string) => Storage.removeItemSync(name),
};

export const useSessionStore = create<SessionStore>()(
  persist(
    (set, get) => ({
      active: null,
      result: null,
      graceRecovered: false,

      start: (selection, plannedMinutes) => {
        const session: ActiveSession = {
          ...selection,
          id: createId(),
          plannedMinutes,
          startedAt: Date.now(),
          backgroundedAt: null,
        };
        set({ active: session, result: null, graceRecovered: false });
        return session;
      },

      markBackgrounded: (now) => {
        const active = get().active;
        if (!active || active.backgroundedAt !== null) return;
        set({ active: { ...active, backgroundedAt: now } });
      },

      clearBackgrounded: () => {
        const active = get().active;
        if (!active) return;
        set({ active: { ...active, backgroundedAt: null } });
      },

      finish: (outcome, endedAt, rolled) => {
        const active = get().active;
        if (!active) return;
        set({
          active: null,
          graceRecovered: false,
          result: {
            ...rolled,
            plannedMinutes: active.plannedMinutes,
            outcome,
            endedAt,
          } as SessionResult,
        });
      },

      acknowledgeResult: () => set({ result: null }),
      setGraceRecovered: (value) => set({ graceRecovered: value }),
    }),
    {
      name: "activeSession",
      version: 2,
      storage: createJSONStorage(() => syncKvStorage),
      partialize: (state) => ({ active: state.active }),
      // v0 snapshots stored `variantId`; v1 added `colorId` with no species
      // axis at all. Carry an in-flight session across BOTH upgrades instead
      // of dropping it — critically, a v1 (or v0) snapshot with no
      // `speciesId` must default to `"molly"`, or species-dispatch code
      // downstream (`SPECIES_DEFS[active.speciesId]`) crashes on `undefined`
      // at the worst possible moment: while the user is settling a session
      // mid-upgrade.
      migrate: (persisted: unknown) => {
        // Deliberately loose: a persisted snapshot from an old build doesn't
        // conform to any current type by definition — that's what's being
        // migrated away from. Work with an untyped record, cast once at the
        // end.
        const state = persisted as { active?: Record<string, unknown> | null } | null;
        const active = state?.active;
        if (active) {
          if (!active.colorId && typeof active.variantId === "string") {
            active.colorId = active.variantId;
          }
          if (!active.speciesId) {
            active.speciesId = "molly";
          }
        }
        return state as { active: ActiveSession | null };
      },
    },
  ),
);
