import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Storage from "expo-sqlite/kv-store";
import { useMemo } from "react";

import { useSessionsQuery } from "@/shared/hooks/use-sessions-query";

import { COLOR_DEFS } from "./catalog";
import type { ColorId } from "./types";
import { isColorUnlocked } from "./unlocks";

const GRANTED_COLORS_KEY = "grantedColors";
const GRANTED_COLORS_QUERY_KEY = ["grantedColors"] as const;

async function readGrantedColors(): Promise<string[]> {
  const raw = await Storage.getItem(GRANTED_COLORS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

/** Manually granted colors — the dev/event stand-in for `streakOrGrant` rules. */
export function useGrantedColors() {
  return useQuery({
    queryKey: GRANTED_COLORS_QUERY_KEY,
    queryFn: readGrantedColors,
  });
}

export function useToggleColorGrantMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (colorId: ColorId) => {
      const granted = await readGrantedColors();
      const next = granted.includes(colorId)
        ? granted.filter((id) => id !== colorId)
        : [...granted, colorId];
      await Storage.setItem(GRANTED_COLORS_KEY, JSON.stringify(next));
      return next;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: GRANTED_COLORS_QUERY_KEY }),
  });
}

export function useUnlocks() {
  const { data: rows } = useSessionsQuery();
  const { data: granted } = useGrantedColors();
  return useMemo(() => {
    const sessionRows = rows ?? [];
    const grantedColors = granted ?? [];
    const entries = COLOR_DEFS.map((def) => ({
      def,
      unlocked: isColorUnlocked(def, sessionRows, grantedColors),
    }));
    return {
      entries,
      unlockedIds: entries.filter((e) => e.unlocked).map((e) => e.def.id),
      grantedColors,
    };
  }, [rows, granted]);
}
