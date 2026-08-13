// Types for the planted-aquarium composition. A `SceneTheme` is authored
// DATA (see `themes/nature-scape.ts`) — normalized placements a human tuned
// by eye — not something computed from a "good taste" heuristic. `compose.ts`
// turns a theme into placed IR per layer; `gen/*` are the pure, seeded shape
// factories each placement instantiates.
//
// Dependency-free: no React/RN/Skia. Runs under plain Node.

import type { Node } from "@/shared/aquarium/core/ir";

export type SceneLayer = "back" | "mid" | "front";

export type SpeciesId =
  | "driftwood"
  | "anubias"
  | "vallisneria"
  | "stemBush"
  | "seiryuStone"
  | "substrateMound"
  | "pebbles"
  | "kelp"
  | "bloom";

/** A point on an already-placed piece of decor that another piece can mount to. */
export interface Anchor {
  x: number;
  y: number;
  /** Outward-facing angle in degrees (0 = +x/right, -90 = up), for natural leaning. */
  angleDeg: number;
}

export interface GeneratedPiece {
  nodes: Node[];
  bbox: { x: number; y: number; width: number; height: number };
  /** Mount points other species can attach to (driftwood exposes these; most don't). */
  anchors: Anchor[];
  /** How far each swaying element sits above its own base — sway amplitude scales with this. */
  swayHeight: number;
}

export interface GeneratorArgs {
  seed: number;
  scale: number;
  /** For species that mount onto another piece (anubias -> driftwood anchor). */
  attachTo?: Anchor;
  /** Horizontal flip of the generated shape — driftwood leans the other way, so a right-side piece can lean inward. Species without a directional lean ignore this. */
  mirror?: boolean;
}

export type Generator = (args: GeneratorArgs) => GeneratedPiece;

/** One item in an authored theme: where, how big, and any attachment. */
export interface Placement {
  species: SpeciesId;
  layer: SceneLayer;
  /** Fraction of canvas width/height, [0,1] — origin at the substrate line, y measured upward. */
  xFraction: number;
  scale: number;
  seed: number;
  /** Index into this placement's own generated anchors that a later placement can reference. */
  attachToId?: string;
  /** This placement's own id, so a later one can `attachToId` it. */
  id?: string;
  /** Which anchor index on the referenced piece to mount at (default 0). */
  anchorIndex?: number;
  /** Horizontal flip — see `GeneratorArgs.mirror`. */
  mirror?: boolean;
}

export interface SwimLane {
  /** Fraction of canvas width, [0,1] — decor placements should mostly clear this band. */
  xFraction: [number, number];
}

export interface SceneTheme {
  name: string;
  placements: Placement[];
  /** Open water the composition deliberately leaves clear for fish to pass through. */
  swimLanes: SwimLane[];
}
