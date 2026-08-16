// Reads/writes individual placements inside `NATURE_SCAPE.placements`
// (`src/shared/aquarium/scene/themes/nature-scape.ts`) for the Scene tab's
// Placements section.
//
// Unlike `scene-design-serialize.ts` (which rewrites ONE big object literal
// wholesale), `nature-scape.ts` carries curatorial comments INTERLEAVED
// BETWEEN placement entries — the concave-U layout, rule-of-thirds focal
// point, and deliberate-asymmetry rationale in the file's header and inline
// section comments ("Kelp goes FIRST so it sits furthest back...", etc.). A
// whole-array rewrite would silently delete those, so this patches each
// placement's `xFraction`/`scale`/`mirror` values in place instead — same
// idea as `swim-const-patch.ts`'s one-line-at-a-time patch of `sim/swim.ts`,
// generalised from "one named const" to "one object literal within an
// array", keyed by that placement's `seed` (unique per placement in
// `NATURE_SCAPE`).
//
// Structural edits — adding/removing/reordering a placement, or changing
// `species`/`layer`/`attachToId`/`id`/`anchorIndex` — aren't supported here;
// the Scene tab's Placements section falls back to Copy-code for those, the
// same split the Shape tab uses for `body-profile.ts`/`fins.ts`.

const PLACEMENTS_MARKER = "placements: [";

export interface PlacementSnapshot {
  seed: number;
  species: string;
  layer: string;
  xFraction: number;
  scale: number;
  mirror: boolean;
  id?: string;
  attachToId?: string;
  anchorIndex?: number;
}

export type PlacementChange = Partial<Pick<PlacementSnapshot, "xFraction" | "scale" | "mirror">>;

interface Span {
  start: number;
  /** Exclusive. */
  end: number;
  text: string;
}

/**
 * Finds each top-level `{ ... }` object literal inside `NATURE_SCAPE.
 * placements`'s array, by brace-depth scanning from `placements: [` to its
 * matching `]`. Placement objects hold only scalar fields (no nested
 * braces), so a simple depth counter is enough — no real parser needed.
 */
function findPlacementSpans(source: string): Span[] {
  const arrayStart = source.indexOf(PLACEMENTS_MARKER);
  if (arrayStart === -1) {
    throw new Error('placement-patch: could not find "placements: [" in nature-scape.ts');
  }
  const spans: Span[] = [];
  let braceDepth = 0;
  let objStart = -1;
  for (let i = arrayStart + PLACEMENTS_MARKER.length; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") {
      if (braceDepth === 0) objStart = i;
      braceDepth++;
    } else if (ch === "}") {
      braceDepth--;
      if (braceDepth === 0 && objStart !== -1) {
        spans.push({ start: objStart, end: i + 1, text: source.slice(objStart, i + 1) });
        objStart = -1;
      }
    } else if (ch === "]" && braceDepth === 0) {
      break; // end of the placements array
    }
  }
  return spans;
}

function numberField(text: string, name: string): number | undefined {
  const m = new RegExp(`${name}\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`).exec(text);
  return m ? Number(m[1]) : undefined;
}

function stringField(text: string, name: string): string | undefined {
  const m = new RegExp(`${name}\\s*:\\s*"([^"]*)"`).exec(text);
  return m?.[1];
}

function boolField(text: string, name: string): boolean {
  const m = new RegExp(`${name}\\s*:\\s*(true|false)`).exec(text);
  return m ? m[1] === "true" : false;
}

/** Every placement's current values, in source order — what the editor renders and drags. */
export function readPlacements(source: string): PlacementSnapshot[] {
  return findPlacementSpans(source).map(({ text }) => {
    const seed = numberField(text, "seed");
    const species = stringField(text, "species");
    const layer = stringField(text, "layer");
    const xFraction = numberField(text, "xFraction");
    const scale = numberField(text, "scale");
    if (seed === undefined || species === undefined || layer === undefined) {
      throw new Error(`placement-patch: malformed placement (missing seed/species/layer): ${text}`);
    }
    if (xFraction === undefined || scale === undefined) {
      throw new Error(`placement-patch: malformed placement (missing xFraction/scale): ${text}`);
    }
    return {
      seed,
      species,
      layer,
      xFraction,
      scale,
      mirror: boolField(text, "mirror"),
      id: stringField(text, "id"),
      attachToId: stringField(text, "attachToId"),
      anchorIndex: numberField(text, "anchorIndex"),
    };
  });
}

function replaceNumberField(text: string, name: string, value: number): string {
  const re = new RegExp(`(${name}\\s*:\\s*)-?\\d+(?:\\.\\d+)?`);
  if (!re.test(text)) {
    throw new Error(`placement-patch: field "${name}" not found in placement: ${text}`);
  }
  return text.replace(re, `$1${value}`);
}

/** Replaces `mirror`'s value if the field already exists; otherwise reports it's missing so the caller can insert it. */
function replaceMirrorField(text: string, value: boolean): { text: string; found: boolean } {
  const re = /(mirror\s*:\s*)(true|false)/;
  if (!re.test(text)) return { text, found: false };
  return { text: text.replace(re, `$1${value}`), found: true };
}

/** Inserts a new `mirror: <value>` right after `seed:` — used when a placement doesn't have the (optional) field yet. */
function insertMirrorField(text: string, value: boolean): string {
  const re = /(seed\s*:\s*-?\d+(?:\.\d+)?)/;
  if (!re.test(text)) {
    throw new Error(`placement-patch: could not find "seed" to anchor a new mirror field: ${text}`);
  }
  return text.replace(re, `$1, mirror: ${value}`);
}

function applyChange(text: string, change: PlacementChange): string {
  let next = text;
  if (change.xFraction !== undefined) {
    if (!Number.isFinite(change.xFraction)) {
      throw new Error(
        `placement-patch: refusing to write non-finite xFraction: ${change.xFraction}`,
      );
    }
    next = replaceNumberField(next, "xFraction", change.xFraction);
  }
  if (change.scale !== undefined) {
    if (!Number.isFinite(change.scale)) {
      throw new Error(`placement-patch: refusing to write non-finite scale: ${change.scale}`);
    }
    next = replaceNumberField(next, "scale", change.scale);
  }
  if (change.mirror !== undefined) {
    const replaced = replaceMirrorField(next, change.mirror);
    next = replaced.found ? replaced.text : insertMirrorField(next, change.mirror);
  }
  return next;
}

/**
 * Rewrites `source` with each changed placement's `xFraction`/`scale`/
 * `mirror` replaced in place, keyed by `seed`. Every other placement, every
 * comment, and every other field survives untouched. Throws if a seed in
 * `changes` doesn't match any placement, rather than silently skipping it.
 */
export function patchPlacements(
  source: string,
  changes: Readonly<Record<number, PlacementChange>>,
): string {
  const spans = findPlacementSpans(source);
  const seeds = new Set(spans.map((span) => numberField(span.text, "seed")));
  for (const key of Object.keys(changes)) {
    if (!seeds.has(Number(key))) {
      throw new Error(`placement-patch: no placement with seed ${key} found in nature-scape.ts`);
    }
  }

  let result = "";
  let cursor = 0;
  for (const span of spans) {
    result += source.slice(cursor, span.start);
    const seed = numberField(span.text, "seed");
    const change = seed !== undefined ? changes[seed] : undefined;
    result += change ? applyChange(span.text, change) : span.text;
    cursor = span.end;
  }
  result += source.slice(cursor);
  return result;
}
