import { Skia, type SkPath } from "@shopify/react-native-skia";

import type { FishVariant } from "@/shared/fish/types";

/**
 * Vector fallback geometry for one fish, in local space:
 * origin at body center, nose pointing LEFT (-x), y down.
 * Adult footprint fits roughly in [-50..62] × [-34..24].
 */
export interface FishGeometry {
  body: SkPath;
  tail: SkPath;
  dorsal: SkPath;
  pelvic: SkPath;
  /** Spot/blotch overlays, clipped to the body when drawn. */
  spots: { cx: number; cy: number; rx: number; ry: number }[];
  eye: { cx: number; cy: number; r: number };
  /** Pivot for the tail-beat rotation. */
  tailPivot: { x: number; y: number };
  bodyHalfHeight: number;
}

const cache = new Map<string, FishGeometry>();

export function fishGeometryFor(variant: FishVariant): FishGeometry {
  const key = variant.id;
  const cached = cache.get(key);
  if (cached) return cached;

  const balloon = variant.bodyShape === "balloon";
  const nose = balloon ? -36 : -46;
  const tailBase = balloon ? 28 : 36;
  const hTop = balloon ? 26 : 20; // height above center line
  const hBot = balloon ? 24 : 18;

  const body = Skia.Path.Make();
  body.moveTo(nose, 0);
  body.quadTo(nose * 0.5, -hTop, 4, -hTop * 0.95);
  body.quadTo(tailBase * 0.8, -hTop * 0.55, tailBase, -4);
  body.lineTo(tailBase, 4);
  body.quadTo(tailBase * 0.8, hBot * 0.55, 4, hBot * 0.95);
  body.quadTo(nose * 0.5, hBot, nose, 0);
  body.close();

  const tail = Skia.Path.Make();
  const tx = tailBase - 2;
  if (variant.finShape === "lyretail") {
    // Twin elongated points with a deep crescent between them.
    tail.moveTo(tx, -5);
    tail.quadTo(tx + 18, -10, tx + 30, -22);
    tail.quadTo(tx + 16, -6, tx + 13, 0);
    tail.quadTo(tx + 16, 6, tx + 30, 22);
    tail.quadTo(tx + 18, 10, tx, 5);
    tail.close();
  } else {
    // Fan tail with a soft notch.
    tail.moveTo(tx, -5);
    tail.quadTo(tx + 14, -14, tx + 20, -16);
    tail.quadTo(tx + 15, -6, tx + 15, 0);
    tail.quadTo(tx + 15, 6, tx + 20, 16);
    tail.quadTo(tx + 14, 14, tx, 5);
    tail.close();
  }

  const dorsal = Skia.Path.Make();
  if (variant.finShape === "sailfin") {
    // The signature sail.
    dorsal.moveTo(-16, -hTop + 3);
    dorsal.quadTo(-6, -hTop - 22, 12, -hTop - 18);
    dorsal.quadTo(20, -hTop - 8, 20, -hTop + 5);
    dorsal.close();
  } else {
    dorsal.moveTo(-6, -hTop + 3);
    dorsal.quadTo(4, -hTop - 11, 14, -hTop + 4);
    dorsal.close();
  }

  const pelvic = Skia.Path.Make();
  pelvic.moveTo(-8, hBot - 3);
  pelvic.quadTo(-2, hBot + 8, 8, hBot - 2);
  pelvic.close();

  const spots =
    variant.colors.spots == null
      ? []
      : variant.id === "marble"
        ? [
            { cx: -18, cy: -4, rx: 9, ry: 6 },
            { cx: 6, cy: 6, rx: 10, ry: 7 },
            { cx: 22, cy: -6, rx: 7, ry: 5 },
            { cx: -4, cy: -10, rx: 6, ry: 4 },
          ]
        : [
            { cx: -16, cy: -6, rx: 3, ry: 3 },
            { cx: 2, cy: 5, rx: 2.6, ry: 2.6 },
            { cx: 13, cy: -8, rx: 2.2, ry: 2.2 },
            { cx: -6, cy: 10, rx: 2.2, ry: 2.2 },
            { cx: 22, cy: 2, rx: 2.6, ry: 2.6 },
            { cx: -27, cy: 3, rx: 1.9, ry: 1.9 },
            { cx: 8, cy: -2, rx: 1.8, ry: 1.8 },
          ];

  const geometry: FishGeometry = {
    body,
    tail,
    dorsal,
    pelvic,
    spots,
    eye: { cx: nose + 12, cy: -5, r: 3.4 },
    tailPivot: { x: tailBase, y: 0 },
    bodyHalfHeight: Math.max(hTop, hBot),
  };
  cache.set(key, geometry);
  return geometry;
}
