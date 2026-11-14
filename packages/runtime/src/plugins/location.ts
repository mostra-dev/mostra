/**
 * Where a JSON path sits in a JSON text, so a diagnostic about a manifest field points at its line
 * and column in `package.json` (INTERFACES §13's location). A small scanner over the text as it
 * is: it never reformats or reparses it into something else.
 */

/** The 1-based line and column of the value at `path` (or of the closest ancestor found). */
export function jsonLocation(
  text: string,
  path: readonly (string | number)[],
): { line: number; column: number } {
  let at = 0;
  const skip = (): void => {
    while (at < text.length && /\s/.test(text[at] as string)) at += 1;
  };
  const string = (): string => {
    // At an opening quote: reads to the matching one, honoring escapes.
    let value = "";
    at += 1;
    while (at < text.length && text[at] !== '"') {
      if (text[at] === "\\") {
        value += text.slice(at, at + 2);
        at += 2;
      } else {
        value += text[at];
        at += 1;
      }
    }
    at += 1;
    try {
      return JSON.parse(`"${value}"`) as string;
    } catch {
      return value;
    }
  };
  const skipValue = (): void => {
    skip();
    const open = text[at];
    if (open === '"') {
      string();
      return;
    }
    if (open === "{" || open === "[") {
      let depth = 0;
      while (at < text.length) {
        const char = text[at];
        if (char === '"') {
          string();
          continue;
        }
        if (char === "{" || char === "[") depth += 1;
        if (char === "}" || char === "]") depth -= 1;
        at += 1;
        if (depth === 0) return;
      }
      return;
    }
    while (at < text.length && !/[,}\]\s]/.test(text[at] as string)) at += 1;
  };
  let found = 0;
  skip();
  for (const part of path) {
    skip();
    const open = text[at];
    if (open === "{" && typeof part === "string") {
      at += 1;
      let hit = false;
      for (;;) {
        skip();
        if (text[at] === "}" || at >= text.length) break;
        const keyAt = at;
        const key = string();
        skip();
        at += 1; // the colon
        if (key === part) {
          skip();
          found = keyAt;
          hit = true;
          break;
        }
        skipValue();
        skip();
        if (text[at] === ",") at += 1;
      }
      if (!hit) break;
    } else if (open === "[" && typeof part === "number") {
      at += 1;
      let index = 0;
      let hit = false;
      for (;;) {
        skip();
        if (text[at] === "]" || at >= text.length) break;
        if (index === part) {
          found = at;
          hit = true;
          break;
        }
        skipValue();
        skip();
        if (text[at] === ",") at += 1;
        index += 1;
      }
      if (!hit) break;
    } else break;
  }
  const before = text.slice(0, found);
  const lines = before.split("\n");
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}
