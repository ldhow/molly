export const SAND_HEIGHT_MAX = 64;

/** Sand band scales with the canvas so landscape doesn't drown in it. */
export function sandHeightFor(height: number): number {
  return Math.max(32, Math.min(SAND_HEIGHT_MAX, height * 0.12));
}

export const BUBBLE_COUNT = 12;

/** Swim speed in px/s at scale 1. */
export const SWIM_SPEED = 55;

export const STAGE_SCALE = {
  egg: 0.3,
  fry: 0.4,
  juvenile: 0.65,
  adult: 1,
} as const;

/** Tank-only shrink — session/fishdex/home previews are unaffected. */
export const TANK_FISH_SCALE = 0.75;
