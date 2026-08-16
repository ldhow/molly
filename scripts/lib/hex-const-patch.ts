// Reads/writes simple `const NAME = "#hex";` string-literal declarations —
// same one-line-at-a-time patch idea as `swim-const-patch.ts`, but for a hex
// colour string instead of a number. Built for the Sprites tab's Colours
// section (`SPRITE_WATER_TOP`/`SPRITE_WATER_MID`/`SPRITE_WATER_BOTTOM`/
// `SAND_BASE_COLOR`/`SAND_BASE_COLOR_BOTTOM` in
// `src/shared/aquarium/render/sprite-layers.tsx`), but not specific to that
// file — any bare `const NAME = "#rrggbb";` line works, given the file's
// source and the list of names to look for.

const HEX_PATTERN = "#[0-9a-fA-F]{3,8}";

// Same trailing `(\\r?)` reasoning as `swim-const-patch.ts`'s
// `declLineRegex` — a CRLF checkout leaves a `\r` `(.*)$` alone can't reach.
function declLineRegex(name: string): RegExp {
  return new RegExp(
    `^(\\s*)(export\\s+)?const\\s+${name}\\s*=\\s*"(${HEX_PATTERN})"\\s*;(.*?)(\\r?)$`,
  );
}

export interface HexConstInfo {
  name: string;
  value: string;
}

/** Reads the current value of every name in `names` from `source`. Throws if any can't be found. */
export function readHexConstants(source: string, names: readonly string[]): HexConstInfo[] {
  const lines = source.split("\n");
  return names.map((name) => {
    const re = declLineRegex(name);
    const idx = lines.findIndex((l) => re.test(l));
    if (idx === -1) {
      throw new Error(`hex-const-patch: could not find 'const ${name} = "#...";'`);
    }
    const match = lines[idx].match(re)!;
    return { name, value: `#${match[3]}` };
  });
}

/**
 * Rewrites `source` with each named constant's hex value replaced in place.
 * Only touches the quoted literal between `=` and `;` on that constant's own
 * declaration line — comments, spacing, and every other line survive
 * untouched. Throws on any unresolvable name or malformed hex value rather
 * than silently skipping it.
 */
export function patchHexConstants(
  source: string,
  changes: Readonly<Record<string, string>>,
): string {
  const lines = source.split("\n");
  for (const [name, value] of Object.entries(changes)) {
    if (value === undefined) continue;
    if (!new RegExp(`^${HEX_PATTERN}$`).test(value)) {
      throw new Error(
        `hex-const-patch: refusing to write malformed hex value for ${name}: ${value}`,
      );
    }
    const re = declLineRegex(name);
    const idx = lines.findIndex((l) => re.test(l));
    if (idx === -1) {
      throw new Error(`hex-const-patch: could not find 'const ${name} = "#...";'`);
    }
    lines[idx] = lines[idx].replace(re, (_m, indent, exportKw, _hex, rest, cr) => {
      return `${indent}${exportKw ?? ""}const ${name} = "${value}";${rest}${cr}`;
    });
  }
  return lines.join("\n");
}
