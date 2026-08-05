export const palette = {
  // water scene
  waterTop: "#0b3a5c",
  waterMid: "#063049",
  waterBottom: "#02131f",
  sand: "#c9b48a",
  sandShadow: "#8f7d5c",

  // app surfaces
  bg: "#04121d",
  surface: "#0a2438",
  surfaceAlt: "#0e2f47",
  border: "#16405e",

  // text
  text: "#eaf6ff",
  textDim: "#8fb3cc",
  textFaint: "#54788f",

  // semantic
  accent: "#37b6ff",
  accentDark: "#1580bd",
  success: "#39d98a",
  danger: "#ff6b6b",
  warning: "#ffc857",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 14,
  lg: 22,
  pill: 999,
} as const;
