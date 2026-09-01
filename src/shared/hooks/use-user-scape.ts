import { useMemo } from "react";

import type { SpriteId } from "@/shared/aquarium";
import { isOwnedDecor } from "@/shared/decor/ownership";
import { scapeFromItems } from "@/shared/decor/scape";
import type { DecorLayer, PlacedDecor } from "@/shared/decor/types";

import { useDecorQuery } from "./use-decor-query";

/** The user's placed decor as a ready-made sprite theme, or `null` when
 *  nothing is placed — `AquariumCanvas` falls back to the authored theme's
 *  backdrop fill in that case (see its `userScape` prop doc). */
export function useUserScape() {
  const { data: rows } = useDecorQuery();

  return useMemo(() => {
    const placed: PlacedDecor[] = (rows ?? [])
      .filter(
        (row) =>
          isOwnedDecor(row) &&
          row.layer !== null &&
          row.xFraction !== null &&
          row.scale !== null &&
          row.sortOrder !== null,
      )
      .map((row) => ({
        id: row.id,
        itemId: row.itemId as SpriteId,
        layer: row.layer as DecorLayer,
        xFraction: row.xFraction as number,
        scale: row.scale as number,
        mirror: row.mirror === 1,
        sortOrder: row.sortOrder as number,
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder);

    return placed.length > 0 ? scapeFromItems(placed) : null;
  }, [rows]);
}
