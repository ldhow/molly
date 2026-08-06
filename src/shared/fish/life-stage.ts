import type { LifeStage } from "./types";

export function stageForProgress(progress: number): LifeStage {
  if (progress < 0.1) return "egg";
  if (progress < 0.4) return "fry";
  if (progress < 0.75) return "juvenile";
  return "adult";
}
