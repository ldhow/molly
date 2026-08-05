/** Perf cap — older fish beyond this are summarized as "+N more". */
export const MAX_RENDERED_FISH = 25;

/** Nominal adult fish footprint in scene units before scaling. */
export const FISH_UNIT = 110;

export const SAND_HEIGHT = 64;

export const BUBBLE_COUNT = 12;

/** Swim speed in px/s at scale 1. */
export const SWIM_SPEED = 55;

export const STAGE_SCALE = {
  egg: 0.3,
  fry: 0.4,
  juvenile: 0.65,
  adult: 1,
} as const;
