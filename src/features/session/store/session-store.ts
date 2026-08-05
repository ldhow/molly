import Storage from "expo-sqlite/kv-store";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { ColorId, FishTraits } from "@/shared/fish/types";
import { createId } from "@/shared/lib/id";

import type { ActiveSession, SessionOutcome, SessionResult } from "../types";

interface SessionStore {
  /** Persisted — the snapshot that survives app kill. */
  active: ActiveSession | null;
  /** In-memory — drives the result sheet after a session ends. */
  result: SessionResult | null;
  /** In-memory — true right after surviving the grace period ("phew"). */
  graceRecovered: boolean;

  start: (colorId: ColorId, plannedMinutes: number) => ActiveSession;
  markBackgrounded: (now: number) => void;
  clearBackgrounded: () => void;
  /** Clears the active session and records the result (traits already rolled). */
  finish: (outcome: SessionOutcome, endedAt: number, traits: FishTraits) => void;
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

      start: (colorId, plannedMinutes) => {
        const session: ActiveSession = {
          id: createId(),
          colorId,
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

      finish: (outcome, endedAt, traits) => {
        const active = get().active;
        if (!active) return;
        set({
          active: null,
          graceRecovered: false,
          result: {
            colorId: active.colorId,
            traits,
            plannedMinutes: active.plannedMinutes,
            outcome,
            endedAt,
          },
        });
      },

      acknowledgeResult: () => set({ result: null }),
      setGraceRecovered: (value) => set({ graceRecovered: value }),
    }),
    {
      name: "activeSession",
      version: 1,
      storage: createJSONStorage(() => syncKvStorage),
      partialize: (state) => ({ active: state.active }),
      // v0 snapshots stored `variantId` — carry an in-flight session across
      // the trait-system update instead of dropping it.
      migrate: (persisted: unknown) => {
        const state = persisted as {
          active?: (ActiveSession & { variantId?: string }) | null;
        } | null;
        if (state?.active && !state.active.colorId && state.active.variantId) {
          state.active = {
            ...state.active,
            colorId: state.active.variantId as ColorId,
          };
        }
        return state as { active: ActiveSession | null };
      },
    },
  ),
);
