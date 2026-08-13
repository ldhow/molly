"use no memo"; // useDerivedValue reads a clock SharedValue — same reasoning
// as fish-layer.tsx's pragma.

import {
  Atlas,
  PaintStyle,
  Skia,
  TileMode,
  useClock,
  type SkImage,
  type SkRSXform,
} from "@shopify/react-native-skia";
import { useMemo } from "react";
import { useDerivedValue } from "react-native-reanimated";

interface Props {
  width: number;
  height: number;
}

const BUBBLE_COUNT = 14;
const SPRITE_SIZE = 28;

let cachedSprite: SkImage | null | undefined;

/** A soft radial-gradient bubble, baked once — <Atlas> instances it via RSXform, one draw call for all bubbles. */
function getBubbleSprite(): SkImage | null {
  if (cachedSprite !== undefined) return cachedSprite;
  const surface = Skia.Surface.Make(SPRITE_SIZE, SPRITE_SIZE);
  if (!surface) {
    cachedSprite = null;
    return null;
  }
  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color("#00000000"));

  const center = SPRITE_SIZE / 2;

  // Faint body: mostly transparent so the water shows through, matching a
  // real bubble far more than a solid disc would.
  const body = Skia.Paint();
  body.setColor(Skia.Color("rgba(210,235,255,0.12)"));
  canvas.drawCircle(center, center, center - 1, body);

  // Bright rim — the meniscus catching the light — thin and near-opaque.
  const rim = Skia.Paint();
  rim.setColor(Skia.Color("rgba(255,255,255,0.65)"));
  rim.setStyle(PaintStyle.Stroke);
  rim.setStrokeWidth(1.1);
  canvas.drawCircle(center, center, center - 1, rim);

  // Small specular highlight, offset upper-left — the classic glass-sphere cue.
  const highlight = Skia.Paint();
  highlight.setShader(
    Skia.Shader.MakeRadialGradient(
      Skia.Point(center - center * 0.32, center - center * 0.32),
      center * 0.42,
      ["rgba(255,255,255,0.85)", "rgba(255,255,255,0)"].map((c) => Skia.Color(c)),
      [0, 1],
      TileMode.Clamp,
    ),
  );
  canvas.drawCircle(center - center * 0.32, center - center * 0.32, center * 0.42, highlight);

  cachedSprite = surface.makeImageSnapshot();
  surface.dispose();
  return cachedSprite;
}

/** Rising bubbles, one <Atlas> draw call regardless of count. */
export function AquariumBubbles({ width, height }: Props) {
  const clock = useClock();
  const sprite = getBubbleSprite();

  const sprites = useMemo(
    () => Array.from({ length: BUBBLE_COUNT }, () => Skia.XYWHRect(0, 0, SPRITE_SIZE, SPRITE_SIZE)),
    [],
  );

  const transforms = useDerivedValue<SkRSXform[]>(() => {
    const t = clock.value / 1000;
    const out: SkRSXform[] = [];
    for (let i = 0; i < BUBBLE_COUNT; i++) {
      const speed = 16 + (i % 5) * 6;
      const scale = 0.28 + ((i * 37) % 10) / 10;
      const xBase = width * ((i * 0.618034) % 1);
      const wobble = Math.sin(t * 1.3 + i * 2.1) * 8;
      const travel = (t * speed + i * 53) % (height + SPRITE_SIZE * 2);
      const y = height + SPRITE_SIZE - travel;
      const x = xBase + wobble;
      out.push(
        Skia.RSXform(scale, 0, x - (scale * SPRITE_SIZE) / 2, y - (scale * SPRITE_SIZE) / 2),
      );
    }
    return out;
  });

  if (!sprite || width <= 0 || height <= 0) return null;
  return <Atlas image={sprite} sprites={sprites} transforms={transforms} />;
}
