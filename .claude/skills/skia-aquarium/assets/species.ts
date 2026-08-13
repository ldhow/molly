/**
 * Species presets: shape + motion in one object.
 *
 * Shape numbers produced recognizable silhouettes when rendered; motion numbers
 * produced a straightness index of 0.50-0.69 and zero tank escapes in
 * simulation. See references/motion.md and references/species.md before
 * changing them.
 *
 * Fin sizes are fractions of `length`, so a preset scales cleanly.
 * Motion units: px/s, rad/s, seconds — assuming roughly a 390x700 canvas.
 */

export type CaudalType = "fork" | "fan" | "veil" | "lyre";

export interface Crest {
  span: readonly [number, number];
  height: number;
  peak: number;
}

export interface Species {
  length: number;
  segments: number;
  /** Fallback depth profile, used for either side when backs/bellies are absent. */
  widths: readonly number[];
  /** Half-depth above the spine. Asymmetry with `bellies` is what stops a sausage. */
  backs?: readonly number[];
  /** Half-depth below the spine; bulge sits further aft than the back's peak. */
  bellies?: readonly number[];
  /** Brow angle of the head wedge. Lower = pointier snout. */
  headTaper?: number;
  /** Eye position along the snout, 0 = nose tip, 1 = back of the head. */
  eyeAt?: number;
  wavelength: number;
  tailBeat: number;
  envelope: readonly [number, number, number];
  turnStiffness: number;
  noseRound: number;
  caudal: { type: CaudalType; length: number; spread: number };
  dorsal: Crest;
  anal?: Crest;
  pectoral: { at: number; length: number; rate: number; sweep: number };
  motion: {
    cruise: number;
    turnRate: number;
    wanderRate: number;
    wanderAmp: number;
    social: number;
    drag: number;
    burstEvery: readonly [number, number];
    band?: number;
  };
  body: string;
  fin: string;
  belly: string;
  eye: string;
}

/** Back profiles: peak arches early, around s = 0.3. */
const BACK = {
  torpedo: [0.042, 0.092, 0.108, 0.104, 0.092, 0.075, 0.056, 0.04, 0.027, 0.019],
  slim: [0.042, 0.082, 0.094, 0.088, 0.078, 0.064, 0.05, 0.037, 0.026, 0.019],
  stocky: [0.05, 0.118, 0.15, 0.152, 0.138, 0.114, 0.088, 0.062, 0.042, 0.028],
  deep: [0.052, 0.115, 0.145, 0.148, 0.136, 0.114, 0.09, 0.066, 0.047, 0.032],
  disc: [0.058, 0.165, 0.215, 0.218, 0.196, 0.158, 0.114, 0.076, 0.049, 0.03],
  round: [0.066, 0.15, 0.188, 0.19, 0.174, 0.144, 0.106, 0.068, 0.044, 0.027],
  flat: [0.07, 0.14, 0.156, 0.142, 0.118, 0.094, 0.069, 0.048, 0.033, 0.023],
  ribbon: [0.028, 0.046, 0.05, 0.05, 0.048, 0.046, 0.042, 0.036, 0.027, 0.015],
} as const;

/** Belly profiles: shallower at the head, bulge peaks later than the back. */
const BELLY = {
  torpedo: [0.034, 0.078, 0.104, 0.112, 0.102, 0.083, 0.062, 0.043, 0.029, 0.02],
  slim: [0.034, 0.07, 0.092, 0.1, 0.094, 0.078, 0.06, 0.043, 0.029, 0.02],
  stocky: [0.04, 0.1, 0.148, 0.168, 0.16, 0.134, 0.102, 0.072, 0.048, 0.031],
  deep: [0.042, 0.098, 0.14, 0.156, 0.148, 0.126, 0.098, 0.072, 0.051, 0.035],
  disc: [0.048, 0.148, 0.212, 0.228, 0.212, 0.174, 0.126, 0.084, 0.054, 0.033],
  round: [0.056, 0.136, 0.186, 0.202, 0.19, 0.158, 0.116, 0.074, 0.047, 0.028],
  flat: [0.052, 0.104, 0.122, 0.122, 0.112, 0.094, 0.07, 0.049, 0.034, 0.024],
  ribbon: [0.026, 0.044, 0.05, 0.05, 0.05, 0.048, 0.044, 0.038, 0.028, 0.016],
} as const;

const PROFILE = {
  torpedo: [0.048, 0.095, 0.112, 0.11, 0.098, 0.08, 0.06, 0.042, 0.028, 0.02],
  slim: [0.05, 0.088, 0.1, 0.096, 0.086, 0.072, 0.058, 0.043, 0.03, 0.022],
  stocky: [0.058, 0.125, 0.155, 0.16, 0.148, 0.124, 0.096, 0.068, 0.046, 0.03],
  deep: [0.06, 0.12, 0.145, 0.15, 0.14, 0.12, 0.095, 0.07, 0.05, 0.034],
  disc: [0.07, 0.17, 0.215, 0.22, 0.2, 0.165, 0.12, 0.08, 0.052, 0.032],
  round: [0.075, 0.155, 0.19, 0.195, 0.18, 0.15, 0.11, 0.07, 0.045, 0.028],
  flat: [0.075, 0.135, 0.15, 0.14, 0.12, 0.098, 0.072, 0.05, 0.034, 0.024],
  ribbon: [0.03, 0.048, 0.052, 0.052, 0.05, 0.048, 0.044, 0.038, 0.028, 0.016],
} as const;

// Measured amplitude envelopes, in body lengths: A(s) = a0 + a1*s + a2*s^2
const ENV = {
  carangiform: [0.02, -0.0825, 0.1625],
  subcarangiform: [0.02, -0.06, 0.14],
  anguilliform: [0.05, 0.15, 0],
} as const;

export const SPECIES: Record<string, Species> = {
  guppy: {
    length: 52, segments: 12, widths: PROFILE.slim, backs: BACK.slim, bellies: BELLY.slim, wavelength: 0.95, tailBeat: 2.6,
    envelope: [0.015, -0.06, 0.16], turnStiffness: 0.9, noseRound: 1, headTaper: 0.55, eyeAt: 0.42,
    caudal: { type: "fan", length: 0.3, spread: 0.6 },
    dorsal: { span: [0.35, 0.55], height: 0.1, peak: 0.45 },
    pectoral: { at: 0.22, length: 0.15, rate: 3.2, sweep: 0.3 },
    motion: { cruise: 30, turnRate: 2.0, wanderRate: 1.1, wanderAmp: 1.2, social: 0.3, drag: 2.0, burstEvery: [0.7, 2.0], band: 0.35 },
    body: "#5FA8D3", fin: "#F4A259", belly: "#9CCBE4", eye: "#12131A",
  },

  molly: {
    length: 68, segments: 12, widths: PROFILE.stocky, backs: BACK.stocky, bellies: BELLY.stocky, wavelength: 1.0, tailBeat: 2.0,
    envelope: ENV.carangiform, turnStiffness: 0.8, noseRound: 1, headTaper: 0.55, eyeAt: 0.42,
    caudal: { type: "fan", length: 0.22, spread: 0.52 },
    dorsal: { span: [0.26, 0.58], height: 0.17, peak: 0.4 },
    anal: { span: [0.58, 0.76], height: 0.09, peak: 0.5 },
    pectoral: { at: 0.26, length: 0.11, rate: 2.6, sweep: 0.3 },
    motion: { cruise: 28, turnRate: 1.8, wanderRate: 1.0, wanderAmp: 1.1, social: 0.25, drag: 1.9, burstEvery: [0.8, 2.2], band: 0.4 },
    body: "#2E2E38", fin: "#8A8FA3", belly: "#4A4A58", eye: "#F2F2F5",
  },

  // Sailfin molly: same body, dramatic dorsal.
  sailfin_molly: {
    length: 70, segments: 12, widths: PROFILE.stocky, backs: BACK.stocky, bellies: BELLY.stocky, wavelength: 1.0, tailBeat: 1.9,
    envelope: ENV.carangiform, turnStiffness: 0.75, noseRound: 1, headTaper: 0.55, eyeAt: 0.42,
    caudal: { type: "fan", length: 0.24, spread: 0.55 },
    dorsal: { span: [0.22, 0.62], height: 0.34, peak: 0.5 },
    anal: { span: [0.58, 0.76], height: 0.1, peak: 0.5 },
    pectoral: { at: 0.26, length: 0.11, rate: 2.4, sweep: 0.3 },
    motion: { cruise: 26, turnRate: 1.7, wanderRate: 0.9, wanderAmp: 1.1, social: 0.25, drag: 1.8, burstEvery: [0.9, 2.4], band: 0.4 },
    body: "#D9A441", fin: "#F0D08A", belly: "#EBC97A", eye: "#12131A",
  },

  betta: {
    length: 58, segments: 12, widths: PROFILE.deep, backs: BACK.deep, bellies: BELLY.deep, wavelength: 1.15, tailBeat: 1.5,
    envelope: [0.02, -0.07, 0.14], turnStiffness: 0.7, noseRound: 0.95, headTaper: 0.5, eyeAt: 0.4,
    caudal: { type: "veil", length: 0.46, spread: 0.7 },
    dorsal: { span: [0.32, 0.72], height: 0.26, peak: 0.6 },
    anal: { span: [0.5, 0.8], height: 0.22, peak: 0.55 },
    pectoral: { at: 0.26, length: 0.12, rate: 4.0, sweep: 0.45 },
    motion: { cruise: 17, turnRate: 1.1, wanderRate: 1.0, wanderAmp: 1.4, social: 0, drag: 1.4, burstEvery: [1.6, 4.0], band: 0.35 },
    body: "#C1436D", fin: "#7A2E8E", belly: "#D96A8C", eye: "#12131A",
  },

  neon_tetra: {
    length: 38, segments: 10, widths: PROFILE.torpedo, backs: BACK.torpedo, bellies: BELLY.torpedo, wavelength: 0.9, tailBeat: 3.2,
    envelope: ENV.carangiform, turnStiffness: 1.1, noseRound: 1, headTaper: 0.5, eyeAt: 0.4,
    caudal: { type: "fork", length: 0.2, spread: 0.5 },
    dorsal: { span: [0.36, 0.52], height: 0.09, peak: 0.45 },
    pectoral: { at: 0.22, length: 0.12, rate: 3.6, sweep: 0.3 },
    motion: { cruise: 44, turnRate: 2.6, wanderRate: 0.9, wanderAmp: 1.0, social: 1.0, drag: 2.5, burstEvery: [0.5, 1.4], band: 0.45 },
    body: "#3FB0C9", fin: "#D64550", belly: "#E8EEF2", eye: "#12131A",
  },

  angelfish: {
    length: 64, segments: 12, widths: PROFILE.disc, backs: BACK.disc, bellies: BELLY.disc, wavelength: 1.3, tailBeat: 1.2,
    envelope: [0.015, -0.05, 0.11], turnStiffness: 0.6, noseRound: 0.9, headTaper: 0.45, eyeAt: 0.38,
    caudal: { type: "lyre", length: 0.34, spread: 0.62 },
    dorsal: { span: [0.16, 0.6], height: 0.42, peak: 0.35 },
    anal: { span: [0.4, 0.82], height: 0.4, peak: 0.4 },
    pectoral: { at: 0.30, length: 0.13, rate: 2.2, sweep: 0.25 },
    motion: { cruise: 20, turnRate: 1.2, wanderRate: 0.8, wanderAmp: 1.1, social: 0.15, drag: 1.3, burstEvery: [1.4, 3.5], band: 0.45 },
    body: "#E8E4D9", fin: "#B9B3A4", belly: "#F5F2EA", eye: "#1A1A22",
  },

  goldfish: {
    length: 72, segments: 12, widths: PROFILE.round, backs: BACK.round, bellies: BELLY.round, wavelength: 1.1, tailBeat: 1.6,
    envelope: ENV.subcarangiform, turnStiffness: 0.7, noseRound: 1.05, headTaper: 0.58, eyeAt: 0.44,
    caudal: { type: "veil", length: 0.38, spread: 0.72 },
    dorsal: { span: [0.24, 0.56], height: 0.2, peak: 0.45 },
    anal: { span: [0.6, 0.8], height: 0.11, peak: 0.5 },
    pectoral: { at: 0.26, length: 0.12, rate: 2.4, sweep: 0.3 },
    motion: { cruise: 26, turnRate: 1.5, wanderRate: 0.9, wanderAmp: 1.1, social: 0.2, drag: 1.6, burstEvery: [1.0, 2.6], band: 0.5 },
    body: "#E8823A", fin: "#F2A868", belly: "#F5C79A", eye: "#12131A",
  },

  corydoras: {
    length: 50, segments: 10, widths: PROFILE.flat, backs: BACK.flat, bellies: BELLY.flat, wavelength: 1.1, tailBeat: 2.2,
    envelope: ENV.subcarangiform, turnStiffness: 0.9, noseRound: 1.1, headTaper: 0.62, eyeAt: 0.46,
    caudal: { type: "fork", length: 0.2, spread: 0.46 },
    dorsal: { span: [0.25, 0.42], height: 0.26, peak: 0.35 },
    pectoral: { at: 0.22, length: 0.2, rate: 5.0, sweep: 0.55 },
    motion: { cruise: 24, turnRate: 3.0, wanderRate: 1.6, wanderAmp: 1.3, social: 0.4, drag: 3.0, burstEvery: [0.4, 1.3], band: 0.88 },
    body: "#9A8C75", fin: "#C3B49A", belly: "#D8CDBA", eye: "#12131A",
  },

  kuhli_loach: {
    length: 90, segments: 18, widths: PROFILE.ribbon, backs: BACK.ribbon, bellies: BELLY.ribbon, wavelength: 0.6, tailBeat: 2.4,
    envelope: ENV.anguilliform, turnStiffness: 1.2, noseRound: 0.9, headTaper: 0.4, eyeAt: 0.36,
    caudal: { type: "fan", length: 0.1, spread: 0.4 },
    dorsal: { span: [0.55, 0.7], height: 0.04, peak: 0.5 },
    pectoral: { at: 0.15, length: 0.07, rate: 4.0, sweep: 0.4 },
    motion: { cruise: 30, turnRate: 3.4, wanderRate: 1.8, wanderAmp: 1.4, social: 0.2, drag: 3.2, burstEvery: [0.5, 1.6], band: 0.92 },
    body: "#8A5A32", fin: "#B98A5A", belly: "#C8A175", eye: "#12131A",
  },

  zebra_danio: {
    length: 40, segments: 10, widths: PROFILE.torpedo, backs: BACK.torpedo, bellies: BELLY.torpedo, wavelength: 0.9, tailBeat: 3.4,
    envelope: ENV.carangiform, turnStiffness: 1.1, noseRound: 1, headTaper: 0.5, eyeAt: 0.4,
    caudal: { type: "fork", length: 0.22, spread: 0.52 },
    dorsal: { span: [0.4, 0.56], height: 0.1, peak: 0.45 },
    pectoral: { at: 0.22, length: 0.12, rate: 3.8, sweep: 0.32 },
    motion: { cruise: 46, turnRate: 2.8, wanderRate: 1.0, wanderAmp: 1.0, social: 0.7, drag: 2.6, burstEvery: [0.4, 1.2], band: 0.4 },
    body: "#7C93B8", fin: "#C8D4E4", belly: "#E4EAF2", eye: "#12131A",
  },

  tadpole: {
    length: 30, segments: 12,
    widths: [0.16, 0.19, 0.16, 0.12, 0.09, 0.07, 0.05, 0.035, 0.025, 0.015],
    wavelength: 0.55, tailBeat: 5.0,
    envelope: ENV.anguilliform, turnStiffness: 1.2, noseRound: 1.2, headTaper: 0.7, eyeAt: 0.5,
    caudal: { type: "fan", length: 0.12, spread: 0.5 },
    dorsal: { span: [0.35, 0.85], height: 0.09, peak: 0.5 },
    anal: { span: [0.35, 0.85], height: 0.09, peak: 0.5 },
    pectoral: { at: 0.2, length: 0.02, rate: 1, sweep: 0 },
    motion: { cruise: 34, turnRate: 3.0, wanderRate: 1.6, wanderAmp: 1.2, social: 0.5, drag: 2.8, burstEvery: [0.4, 1.2], band: 0.6 },
    body: "#3D4A3A", fin: "#6E7F68", belly: "#57654F", eye: "#0E0F14",
  },
};

/** Per-individual variation. Skipping this is the most visible artificiality. */
export const jitter = () => ({
  scale: 0.9 + Math.random() * 0.2,
  beat: 0.85 + Math.random() * 0.3,
  cruise: 0.9 + Math.random() * 0.2,
  phase: Math.random() * Math.PI * 2,
  z: Math.random(),
});
