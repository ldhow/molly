// Reads/writes individual placements inside `SPRITE_SCAPE.placements`
// (`src/shared/aquarium/scene/themes/nature-scape-sprites.ts`) for the
// Sprites tab's Placements section — same idea as `placement-patch.ts` for
// the procedural theme's `nature-scape.ts`, but keyed by ARRAY INDEX rather
// than a `seed` field: `SpritePlacement` (`scene/compose-sprites.ts`) has no
// unique id of its own (a sprite piece isn't generated from a seed, it's a
// fixed PNG), so position in the array is the only stable handle available
// without changing that type. This is fine for in-session editing (the
// array's read once at boot and never reordered underneath the tool) but
// means a hand-edit to `nature-scape-sprites.ts` that reorders/adds/removes
// placements between "open the tool" and "save" would misapply — same
// caveat any index-keyed diff has.
//
// Adding a new placement IS supported (`insertSpritePlacements`, appends
// literal entries just before the array's closing `]`) — sprite placements
// have no attachment/anchor logic to resolve (unlike the procedural theme's
// `attachToId`/`anchorIndex`) and no per-entry curatorial prose to preserve
// mid-array, so a textual append is safe. Removing or reordering an
// EXISTING (already-saved) placement, or changing its `spriteId`/`layer`,
// still isn't supported here — Copy-code is the fallback for those, same
// split `placement-patch.ts` uses for its own structural edits.

const PLACEMENTS_MARKER = "placements: [";

export interface SpritePlacementSnapshot {
  spriteId: string;
  layer: string;
  xFraction: number;
  scale: number;
  mirror: boolean;
}

export type SpritePlacementChange = Partial<
  Pick<SpritePlacementSnapshot, "xFraction" | "scale" | "mirror">
>;

export interface NewSpritePlacement {
  spriteId: string;
  layer: string;
  xFraction: number;
  scale: number;
  mirror?: boolean;
}

interface Span {
  start: number;
  /** Exclusive. */
  end: number;
  text: string;
}

/** Identical brace-depth scan to `placement-patch.ts`'s — see that file for why a real parser isn't needed. */
function findPlacementSpans(source: string): Span[] {
  const arrayStart = source.indexOf(PLACEMENTS_MARKER);
  if (arrayStart === -1) {
    throw new Error(
      'sprite-placement-patch: could not find "placements: [" in nature-scape-sprites.ts',
    );
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

/** Every placement's current values, in source order (= the index `patchSpritePlacements` keys on) — what the editor renders and drags. */
export function readSpritePlacements(source: string): SpritePlacementSnapshot[] {
  return findPlacementSpans(source).map(({ text }) => {
    const spriteId = stringField(text, "spriteId");
    const layer = stringField(text, "layer");
    const xFraction = numberField(text, "xFraction");
    const scale = numberField(text, "scale");
    if (spriteId === undefined || layer === undefined) {
      throw new Error(
        `sprite-placement-patch: malformed placement (missing spriteId/layer): ${text}`,
      );
    }
    if (xFraction === undefined || scale === undefined) {
      throw new Error(
        `sprite-placement-patch: malformed placement (missing xFraction/scale): ${text}`,
      );
    }
    return { spriteId, layer, xFraction, scale, mirror: boolField(text, "mirror") };
  });
}

function replaceNumberField(text: string, name: string, value: number): string {
  const re = new RegExp(`(${name}\\s*:\\s*)-?\\d+(?:\\.\\d+)?`);
  if (!re.test(text)) {
    throw new Error(`sprite-placement-patch: field "${name}" not found in placement: ${text}`);
  }
  return text.replace(re, `$1${value}`);
}

/** Replaces `mirror`'s value if the field already exists; otherwise reports it's missing so the caller can insert it. */
function replaceMirrorField(text: string, value: boolean): { text: string; found: boolean } {
  const re = /(mirror\s*:\s*)(true|false)/;
  if (!re.test(text)) return { text, found: false };
  return { text: text.replace(re, `$1${value}`), found: true };
}

/** Inserts a new `mirror: <value>` right after `scale:` — used when a placement doesn't have the (optional) field yet. */
function insertMirrorField(text: string, value: boolean): string {
  const re = /(scale\s*:\s*-?\d+(?:\.\d+)?)/;
  if (!re.test(text)) {
    throw new Error(
      `sprite-placement-patch: could not find "scale" to anchor a new mirror field: ${text}`,
    );
  }
  return text.replace(re, `$1, mirror: ${value}`);
}

function applyChange(text: string, change: SpritePlacementChange): string {
  let next = text;
  if (change.xFraction !== undefined) {
    if (!Number.isFinite(change.xFraction)) {
      throw new Error(
        `sprite-placement-patch: refusing to write non-finite xFraction: ${change.xFraction}`,
      );
    }
    next = replaceNumberField(next, "xFraction", change.xFraction);
  }
  if (change.scale !== undefined) {
    if (!Number.isFinite(change.scale)) {
      throw new Error(
        `sprite-placement-patch: refusing to write non-finite scale: ${change.scale}`,
      );
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
 * `mirror` replaced in place, keyed by ARRAY INDEX (0-based, source order —
 * see the header for why not a stable id). Every other placement, every
 * comment, and every other field survives untouched. Throws if an index in
 * `changes` is out of range, rather than silently skipping it.
 */
export function patchSpritePlacements(
  source: string,
  changes: Readonly<Record<number, SpritePlacementChange>>,
): string {
  const spans = findPlacementSpans(source);
  for (const key of Object.keys(changes)) {
    const index = Number(key);
    if (index < 0 || index >= spans.length) {
      throw new Error(
        `sprite-placement-patch: index ${key} out of range (${spans.length} placements) in nature-scape-sprites.ts`,
      );
    }
  }

  let result = "";
  let cursor = 0;
  spans.forEach((span, index) => {
    result += source.slice(cursor, span.start);
    const change = changes[index];
    result += change ? applyChange(span.text, change) : span.text;
    cursor = span.end;
  });
  result += source.slice(cursor);
  return result;
}

function formatNewPlacement(p: NewSpritePlacement, indent: string): string {
  if (!Number.isFinite(p.xFraction) || !Number.isFinite(p.scale)) {
    throw new Error(
      `sprite-placement-patch: refusing to insert a placement with non-finite xFraction/scale: ${JSON.stringify(p)}`,
    );
  }
  const mirrorPart = p.mirror ? `, mirror: ${p.mirror}` : "";
  return `${indent}{ spriteId: "${p.spriteId}", layer: "${p.layer}", xFraction: ${p.xFraction}, scale: ${p.scale}${mirrorPart} },`;
}

/**
 * Appends each of `additions` as a new placement entry, right before the
 * array's closing `]` (or right after `placements: [` if the array is
 * currently empty). Indentation matches the last existing entry (falls back
 * to 4 spaces for an empty array, this file's prevailing style). Every
 * existing placement, every comment, and everything outside the array
 * survives untouched.
 */
export function insertSpritePlacements(
  source: string,
  additions: readonly NewSpritePlacement[],
): string {
  if (additions.length === 0) return source;
  const spans = findPlacementSpans(source);

  if (spans.length === 0) {
    const arrayStart = source.indexOf(PLACEMENTS_MARKER);
    const insertAt = arrayStart + PLACEMENTS_MARKER.length;
    const literal = additions.map((p) => formatNewPlacement(p, "    ")).join("\n");
    return `${source.slice(0, insertAt)}\n${literal}\n  ${source.slice(insertAt)}`;
  }

  const lastSpan = spans[spans.length - 1];
  // Match the last entry's own leading indentation (the whitespace run
  // immediately before its `{`), so a new entry lines up the same way.
  const lineStart = source.lastIndexOf("\n", lastSpan.start) + 1;
  const indent = source.slice(lineStart, lastSpan.start);
  const literal = additions.map((p) => formatNewPlacement(p, indent)).join("\n");
  // The last existing entry may or may not already have a trailing comma of
  // its own (both are valid array-literal JS). If it does, insert AFTER
  // that comma — inserting before it would leave the comma dangling after
  // our new (already comma-terminated) entries instead of after the old
  // last entry. If it doesn't, insert right at the entry's end and supply
  // our own comma.
  const afterLast = source.slice(lastSpan.end);
  const existingComma = /^\s*,/.exec(afterLast);
  const insertAt = existingComma ? lastSpan.end + existingComma[0].length : lastSpan.end;
  const prefix = existingComma ? "" : ",";
  return `${source.slice(0, insertAt)}${prefix}\n${literal}${source.slice(insertAt)}`;
}
