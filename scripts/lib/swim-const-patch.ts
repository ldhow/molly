// Reads/writes the tuned numeric constants in `sim/swim.ts` (`TURN_RATE_MIN`,
// `ACCEL_TAU`, `ROLL_GAIN`, ...) for `scripts/aquarium-design-editor.ts`'s
// Motion tab.
//
// Unlike `scripts/lib/design-serialize.ts` (which rewrites ONE big object
// literal, `tank-design.ts`'s comments living only above it), `sim/swim.ts`
// carries a separate explanatory comment above (or trailing) EACH constant —
// real design rationale ("Raised from 0.5: a faster accel tau read as a
// sudden jolt...", "0.35 (the skill suggests up to ~0.55)..."). A literal
// rewrite of the whole file would have to reconstruct that prose, so this
// patches ONE line at a time instead: find `const NAME = <number>;`, replace
// only the number, leave everything else — the comment above it, the
// trailing comment on the same line, every other line — byte-identical.

const CONST_NAMES = [
  "Z_MAX",
  "TURN_RATE_MIN",
  "TURN_RATE_MAX_WALL",
  "TURN_RATE_BURST",
  "ACCEL_TAU",
  "DECEL_TAU",
  "PITCH_TAU",
  "ROLL_TAU",
  "TURN_RATE_TAU",
  "Y_TAU",
  "WALL_MARGIN_X",
  "WALL_MARGIN_Z",
  "ARRIVE_RADIUS",
  "HOVER_JITTER",
  "VERTICAL_WANDER",
  "MAX_DT",
  "ROLL_GAIN",
  "ROLL_MAX",
  "TURN_SPEED_PENALTY_MAX",
  "BROADSIDE_BIAS",
  "CURRENT_FREQ",
  "CURRENT_DRIFT_MAX",
] as const;

export type SwimConstName = (typeof CONST_NAMES)[number];

export interface SwimConstInfo {
  name: SwimConstName;
  value: number;
  /** Leading block/line comment(s) immediately above the declaration, plus any trailing same-line comment, with comment-syntax markers stripped. Empty string if none. */
  doc: string;
}

function declLineRegex(name: string): RegExp {
  return new RegExp(`^(\\s*)(export\\s+)?const\\s+${name}\\s*=\\s*(-?\\d+(?:\\.\\d+)?)\\s*;(.*)$`);
}

/** Strips line- and block-comment markers (leading `//`, leading `*`, and JSDoc open/close), keeping the prose. */
function cleanCommentLine(line: string): string {
  return line
    .trim()
    .replace(/^\/\*\*?/, "")
    .replace(/\*\/$/, "")
    .replace(/^\*/, "")
    .replace(/^\/\//, "")
    .trim();
}

/**
 * Walks upward from `declIndex` collecting a contiguous run of comment
 * lines (either a JSDoc block or consecutive `//` lines), stopping at the
 * first blank or non-comment line — the same "immediately above, no gap"
 * convention every constant in `swim.ts` already follows.
 */
function leadingCommentFor(lines: readonly string[], declIndex: number): string {
  let start = declIndex;
  while (start > 0) {
    const prev = lines[start - 1].trim();
    if (prev === "" || !(prev.startsWith("//") || prev.startsWith("*") || prev.startsWith("/**"))) {
      break;
    }
    start--;
  }
  if (start === declIndex) return "";
  return lines.slice(start, declIndex).map(cleanCommentLine).filter(Boolean).join(" ");
}

/**
 * Reads the current value + doc for every tunable in `source` (the raw text
 * of `sim/swim.ts`). Throws if a name from `CONST_NAMES` can't be found, so
 * a rename in `swim.ts` fails loudly here instead of the editor silently
 * showing a stale slider.
 */
export function readSwimConstants(source: string): SwimConstInfo[] {
  const lines = source.split("\n");
  return CONST_NAMES.map((name) => {
    const re = declLineRegex(name);
    const idx = lines.findIndex((l) => re.test(l));
    if (idx === -1) {
      throw new Error(`swim-const-patch: could not find "const ${name} = ..." in sim/swim.ts`);
    }
    const match = lines[idx].match(re)!;
    const value = Number(match[3]);
    const trailing = cleanCommentLine(match[4] ?? "");
    const leading = leadingCommentFor(lines, idx);
    const doc = [leading, trailing].filter(Boolean).join(" — ");
    return { name, value, doc };
  });
}

/**
 * Rewrites `source` with each named constant's value replaced in place.
 * Only touches the numeric literal between `=` and `;` on that constant's
 * own declaration line — comments, spacing, and every other line survive
 * untouched. Throws on any unresolvable name or non-finite value rather
 * than silently skipping it.
 */
export function patchSwimConstants(
  source: string,
  changes: Readonly<Partial<Record<SwimConstName, number>>>,
): string {
  const lines = source.split("\n");
  for (const [name, value] of Object.entries(changes)) {
    if (value === undefined) continue;
    if (!Number.isFinite(value)) {
      throw new Error(`swim-const-patch: refusing to write non-finite value for ${name}: ${value}`);
    }
    const re = declLineRegex(name);
    const idx = lines.findIndex((l) => re.test(l));
    if (idx === -1) {
      throw new Error(`swim-const-patch: could not find "const ${name} = ..." in sim/swim.ts`);
    }
    lines[idx] = lines[idx].replace(re, (_m, indent, exportKw, _num, rest) => {
      return `${indent}${exportKw ?? ""}const ${name} = ${String(value)};${rest}`;
    });
  }
  return lines.join("\n");
}

export { CONST_NAMES as SWIM_CONST_NAMES };
