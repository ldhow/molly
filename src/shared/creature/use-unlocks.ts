import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Storage from "expo-sqlite/kv-store";
import { useMemo } from "react";

import { useSessionsQuery } from "@/shared/hooks/use-sessions-query";

import { SPECIES_LIST } from "./catalog";
import type { SpeciesId } from "./types";
import { isSpeciesUnlocked } from "./unlocks";

const GRANTED_SPECIES_KEY = "grantedSpecies";
const GRANTED_SPECIES_QUERY_KEY = ["grantedSpecies"] as const;

async function readGrantedSpecies(): Promise<string[]> {
  const raw = await Storage.getItem(GRANTED_SPECIES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

/** Manually granted species — the dev/event stand-in for `streakOrGrant` rules. Mirrors `@/shared/fish/use-unlocks.ts`'s `useGrantedColors`. */
export function useGrantedSpecies() {
  return useQuery({
    queryKey: GRANTED_SPECIES_QUERY_KEY,
    queryFn: readGrantedSpecies,
  });
}

export function useToggleSpeciesGrantMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (speciesId: SpeciesId) => {
      const granted = await readGrantedSpecies();
      const next = granted.includes(speciesId)
        ? granted.filter((id) => id !== speciesId)
        : [...granted, speciesId];
      await Storage.setItem(GRANTED_SPECIES_KEY, JSON.stringify(next));
      return next;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: GRANTED_SPECIES_QUERY_KEY }),
  });
}

export function useSpeciesUnlocks() {
  const { data: rows } = useSessionsQuery();
  const { data: granted } = useGrantedSpecies();
  return useMemo(() => {
    const sessionRows = rows ?? [];
    const grantedSpecies = granted ?? [];
    const entries = SPECIES_LIST.map((def) => ({
      def,
      unlocked: isSpeciesUnlocked(def, sessionRows, grantedSpecies),
    }));
    return {
      entries,
      unlockedIds: entries.filter((e) => e.unlocked).map((e) => e.def.id),
      grantedSpecies,
    };
  }, [rows, granted]);
}
