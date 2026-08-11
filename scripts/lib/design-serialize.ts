// Serializes a TankDesign back into `tank-design.ts`.
//
// The editor's Save button uses this. It only ever rewrites the
// `DEFAULT_TANK_DESIGN` literal — the interfaces and every comment above it
// are preserved verbatim, so the documentation in that file survives a save.

import { DEFAULT_TANK_DESIGN, type TankDesign } from "../../src/shared/components/tank/tank-design";

const MARKER = "export const DEFAULT_TANK_DESIGN: TankDesign = ";

/**
 * Exact, shortest round-tripping form.
 *
 * Deliberately NOT rounded: `Number(String(n)) === n` always holds in JS, and
 * a serializer that quietly loses precision would drift the design a little
 * on every save. Values like `Math.PI / 2` must survive verbatim. Rounding to
 * a friendly step is the editor's job, at the point the user sets the value.
 */
function num(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`Refusing to serialize non-finite number: ${n}`);
  return String(n);
}

function isVecLike(v: unknown[]): boolean {
  return v.every((x) => typeof x === "number");
}

function literal(value: unknown, indent: string): string {
  if (typeof value === "number") return num(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return String(value);

  if (Array.isArray(value)) {
    // Numeric tuples stay on one line; they read as points, not lists.
    if (isVecLike(value)) return `[${value.map((v) => num(v as number)).join(", ")}]`;
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
 * Rewrite the `DEFAULT_TANK_DESIGN` literal inside the existing source,
 * leaving everything above it (types, comments) untouched.
 */
export function serializeDesign(currentSource: string, design: TankDesign): string {
  const at = currentSource.indexOf(MARKER);
  if (at === -1) {
    throw new Error(
      "Could not find DEFAULT_TANK_DESIGN in tank-design.ts — refusing to overwrite the file.",
    );
  }
  const head = currentSource.slice(0, at);
  return `${head}${MARKER}${literal(design, "")};\n`;
}

/**
 * Structural comparison against the shipped defaults, so the editor can show
 * which sections you've actually changed.
 */
export function diffKeys(design: TankDesign): string[] {
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
  walk(design, DEFAULT_TANK_DESIGN, "");
  return changed;
}
