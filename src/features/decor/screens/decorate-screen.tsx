import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { DecorItemRow } from "@/db/schema";
import { composeSpriteScene } from "@/shared/aquarium";
import { Button } from "@/shared/components/button";
import { CoinChip } from "@/shared/components/coin-chip";
import { EmptyState } from "@/shared/components/empty-state";
import { ScreenContainer } from "@/shared/components/screen-container";
import { TankView } from "@/shared/components/tank/tank-view";
import { sandHeightFor } from "@/shared/constants/tank";
import { palette, radius, spacing } from "@/shared/constants/theme";
import { autoPlaceXFraction } from "@/shared/decor/auto-place";
import { getDecorDef } from "@/shared/decor/catalog";
import { decorResellPriceOf } from "@/shared/decor/pricing";
import type { DecorLayer } from "@/shared/decor/types";
import { useOwnedFish } from "@/shared/hooks/use-owned-fish";
import { useUserScape } from "@/shared/hooks/use-user-scape";

import { useOwnedDecor } from "../api/use-owned-decor";
import { usePlaceDecorMutation, type PlaceArgs } from "../api/use-place-decor-mutation";
import { useRemoveDecorMutation } from "../api/use-remove-decor-mutation";
import { useResellDecorMutation } from "../api/use-resell-decor-mutation";
import { DragCanvas } from "../components/drag-canvas";
import { InventoryStrip } from "../components/inventory-strip";
import { PlacementToolbar, type PlacementState } from "../components/placement-toolbar";

export function DecorateScreen() {
  const router = useRouter();
  const { fish } = useOwnedFish();
  const userScape = useUserScape();
  const { all: items } = useOwnedDecor();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  const place = usePlaceDecorMutation();
  const remove = useRemoveDecorMutation();
  const resell = useResellDecorMutation();

  // Hit-testable pieces for tap-to-select on the canvas — the EXACT same
  // pure composition `AquariumCanvas` renders from (see its `composeSpriteScene`
  // re-export doc), run a second time here with the SAME dimensions and
  // substrate math it uses (this screen doesn't pass `pannable`, so its
  // `sceneBounds` is just the viewport — this canvas's measured size).
  const hitPieces = useMemo(() => {
    if (!userScape || canvasSize.width <= 0 || canvasSize.height <= 0) return [];
    const substrateY = canvasSize.height - sandHeightFor(canvasSize.height);
    return composeSpriteScene(userScape, canvasSize.width, canvasSize.height, substrateY).pieces;
  }, [userScape, canvasSize]);

  const selectedRow = items.find((row) => row.id === selectedId) ?? null;
  const selectedDef = selectedRow ? getDecorDef(selectedRow.itemId) : undefined;

  // The single source of truth for "where is the selected item right now" —
  // used by both the toolbar's steppers and the drag gesture, so dragging
  // and nudging never fight over stale state.
  const currentState: PlacementState | null =
    selectedRow && selectedDef
      ? {
          layer: (selectedRow.layer as DecorLayer) ?? selectedDef.layers[0],
          xFraction: selectedRow.xFraction ?? 0.5,
          scale: selectedRow.scale ?? selectedDef.defaultScale,
          mirror: selectedRow.mirror === 1,
          sortOrder: selectedRow.sortOrder ?? 0,
        }
      : null;

  const selectItem = (row: DecorItemRow) => {
    setInventoryOpen(false);
    if (row.layer !== null) {
      setSelectedId(row.id);
      return;
    }
    // Unplaced — place it at a rotating default spot the moment it's picked
    // (not a flat center every time — that was stacking every newly-placed
    // item on top of the last one), so tapping an inventory item is the "put
    // it in the tank" action, and the toolbar has something to edit right away.
    const def = getDecorDef(row.itemId);
    if (!def) return;
    const placedCount = items.filter((i) => i.layer !== null).length;
    const maxSort = items.reduce((max, i) => Math.max(max, i.sortOrder ?? -1), -1);
    const args: PlaceArgs = {
      id: row.id,
      layer: def.layers[0],
      xFraction: autoPlaceXFraction(placedCount),
      scale: def.defaultScale,
      mirror: false,
      sortOrder: maxSort + 1,
    };
    place.mutate(args);
    setSelectedId(row.id);
  };

  const updatePlacement = (next: PlacementState) => {
    if (!selectedRow) return;
    place.mutate({ id: selectedRow.id, ...next });
  };

  const onDragEnd = (xFraction: number) => {
    if (!currentState) return;
    updatePlacement({ ...currentState, xFraction });
  };

  const putAway = () => {
    if (!selectedRow) return;
    remove.mutate(selectedRow.id);
    setSelectedId(null);
  };

  const confirmResell = () => {
    if (!selectedRow || !selectedDef) return;
    const price = decorResellPriceOf(selectedRow.pricePaid);
    Alert.alert(
      "Sell this item?",
      `Sell your ${selectedDef.name} back for ${price} coins? This is permanent.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Sell",
          style: "destructive",
          onPress: () => {
            resell.mutate(selectedRow.id);
            setSelectedId(null);
          },
        },
      ],
    );
  };

  return (
    <ScreenContainer edgeToEdge>
      <View style={styles.header}>
        <Button label="‹ Back" variant="ghost" onPress={() => router.back()} />
        <Text style={styles.title}>Arrange your tank</Text>
        <CoinChip />
      </View>

      {/*
        The canvas fills EVERYTHING below the header, in both orientations —
        it used to share the screen with a permanently-reserved bottom panel
        (or a landscape sidebar), which is exactly what read as "quá nhỏ và
        bất tiện" (too small and inconvenient) once the toolbar grew past a
        couple of rows. The toolbar and the item picker are now floating
        popups that appear ONLY when needed, so the tank always gets the
        full screen and the controls always get as much room as they need.
      */}
      <View
        style={styles.canvasWrap}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          setCanvasSize({ width, height });
        }}
      >
        <DragCanvas
          selectedDef={selectedDef ?? null}
          onDragEnd={onDragEnd}
          pieces={hitPieces}
          onSelectAt={setSelectedId}
          onDraggingChange={setIsDragging}
        >
          <TankView
            fish={fish}
            style={StyleSheet.absoluteFill as never}
            userScape={userScape}
            highlightId={selectedId}
          />
        </DragCanvas>

        {/* Hidden entirely while actually dragging — an overlay anywhere on
            screen would otherwise cover the ghost or the item mid-move, and
            decor sits near the substrate at the BOTTOM of the tank most of
            the time, which is exactly where a bottom-anchored popup used to
            sit. Anchored to the TOP the rest of the time for the same
            reason: the top of the tank is mostly open water, so a
            persistent panel there is the least likely spot to cover a
            selected item. */}
        {isDragging ? null : selectedRow && selectedDef && currentState ? (
          <View style={styles.toolbarPopup}>
            <Text style={styles.dragHint}>Drag anywhere on the tank to move it.</Text>
            <PlacementToolbar
              def={selectedDef}
              state={currentState}
              onChange={updatePlacement}
              onPutAway={putAway}
              resalePrice={decorResellPriceOf(selectedRow.pricePaid)}
              onResell={confirmResell}
            />
          </View>
        ) : (
          <Pressable style={styles.fab} onPress={() => setInventoryOpen(true)}>
            <Text style={styles.fabText}>
              🎒 Items{items.length > 0 ? ` (${items.length})` : ""}
            </Text>
          </Pressable>
        )}

        {inventoryOpen ? (
          <View style={styles.inventorySheet}>
            <View style={styles.inventoryHeader}>
              <Text style={styles.inventoryTitle}>Your items</Text>
              <Pressable onPress={() => setInventoryOpen(false)} hitSlop={8}>
                <Text style={styles.inventoryClose}>✕</Text>
              </Pressable>
            </View>
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.inventoryContent}
            >
              {items.length === 0 ? (
                <EmptyState
                  emoji="🛍️"
                  title="Nothing to arrange yet"
                  caption="Buy something from the Decor Store first."
                />
              ) : (
                <InventoryStrip items={items} selectedId={selectedId} onSelect={selectItem} />
              )}
            </ScrollView>
          </View>
        ) : null}
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  title: { color: palette.text, fontSize: 16, fontWeight: "700" },
  canvasWrap: { flex: 1, backgroundColor: palette.waterBottom },
  fab: {
    position: "absolute",
    right: spacing.md,
    bottom: spacing.md,
    backgroundColor: palette.accent,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  fabText: { color: "#03222f", fontWeight: "700", fontSize: 13 },
  toolbarPopup: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    top: spacing.md,
    gap: spacing.xs,
  },
  dragHint: {
    color: palette.textFaint,
    fontSize: 11,
    textAlign: "center",
    backgroundColor: "rgba(4, 18, 29, 0.55)",
    borderRadius: radius.sm,
    paddingVertical: 2,
  },
  inventorySheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: "70%",
    backgroundColor: palette.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
  },
  inventoryHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  inventoryTitle: { color: palette.text, fontSize: 15, fontWeight: "700" },
  inventoryClose: { color: palette.textDim, fontSize: 16, fontWeight: "700" },
  inventoryContent: { padding: spacing.md },
});
