/** How long the app may stay backgrounded before the fish dies. */
export const GRACE_MS = 10_000;

/** Seconds after backgrounding before the "come back" notification fires. */
export const DYING_NOTIFICATION_DELAY_S = 7;

export const DURATION_PRESETS_MINUTES = [10, 15, 25, 30, 45, 60, 90, 120];

export const DEFAULT_DURATION_MINUTES = 25;

export const NOTIFICATION_COPY = {
  dyingTitle: (noun: string) => `Your ${noun} is gasping! 🐟`,
  dyingBody: "Come back within a few seconds or it won't make it.",
  completedTitle: "Focus complete! 🎉",
  completedBody: (noun: string) => `Your ${noun} grew up and joined the tank.`,
} as const;
