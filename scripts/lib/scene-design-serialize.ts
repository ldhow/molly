// Serializes a SceneDesign back into `scene-design.ts`.
//
// The Scene tab's Save button uses this. It only ever rewrites the
// `DEFAULT_SCENE_DESIGN` literal — the interfaces and every comment above it
// (including the per-species JSDoc) are preserved verbatim, so the
// documentation in that file survives a save. Same technique as
// `design-serialize.ts` for `tank-design.ts`; kept as a separate small file
// rather than sharing one generic serializer, matching how `swim-const-
// patch.ts` stays its own file alongside `design-serialize.ts` despite the
// conceptual overlap.

import {
  DEFAULT_SCENE_DESIGN,
  type SceneDesign,
} from "../../src/shared/aquarium/scene/scene-design";

const MARKER = "export const DEFAULT_SCENE_DESIGN: SceneDesign = ";

/**
 * Exact, shortest round-tripping form. Deliberately NOT rounded — see
 * `design-serialize.ts`'s identical `num()` for why: `Number(String(n)) ===
 * n` always holds in JS, and rounding here would quietly drift the design a
 * little on every save. Rounding to a friendly step is the editor's job, at
 * the point the user sets the value.
 */
function num(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`Refusing to serialize non-finite number: ${n}`);
  return String(n);
}

function literal(value: unknown, indent: string): string {
  if (typeof value === "number") return num(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return String(value);

  if (Array.isArray(value)) {
    const inner = indent + "  ";
    const items = value.map((v) => `${inner}${literal(v, inner)},`).join("\n");
    return `[\n${items}\n${indent}]`;
  }

  if (value && typeof value === "object") {
    const inner = indent + "  ";
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${inner}${k}: ${literal(v, inner)},`)
      .join("\n");
    return `{\n${entries}\n${indent}}`;
  }

  throw new Error(`Cannot serialize value of type ${typeof value}`);
}

/**
 * Rewrite the `DEFAULT_SCENE_DESIGN` literal inside the existing source,
 * leaving everything above it (interfaces, JSDoc) untouched.
 */
export function serializeSceneDesign(currentSource: string, design: SceneDesign): string {
  const at = currentSource.indexOf(MARKER);
  if (at === -1) {
    throw new Error(
      "Could not find DEFAULT_SCENE_DESIGN in scene-design.ts — refusing to overwrite the file.",
    );
  }
  const head = currentSource.slice(0, at);
  return `${head}${MARKER}${literal(design, "")};\n`;
}

/** Structural comparison against the shipped defaults, so the editor can show which sections you've actually changed. */
export function diffKeys(design: SceneDesign): string[] {
  const changed: string[] = [];
  const walk = (a: unknown, b: unknown, path: string) => {
    if (Array.isArray(a) || Array.isArray(b) || typeof a !== "object" || a === null) {
      if (JSON.stringify(a) !== JSON.stringify(b)) changed.push(path);
      return;
    }
    for (const k of Object.keys(a as Record<string, unknown>)) {
      walk(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)?.[k],
        path ? `${path}.${k}` : k,
      );
    }
  };
  walk(design, DEFAULT_SCENE_DESIGN, "");
  return changed;
}
