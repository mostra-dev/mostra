/**
 * Markdown for agents (INTERFACES §8): text from viewers and hosts as data, never structure. The
 * results' and the review's renderers share these.
 */
/**
 * Text from viewers and hosts is data in the Markdown, never structure (Claude review finding 4):
 * labels and string values are JSON strings, identifiers and JSON are code spans whose delimiters
 * outrun any backticks inside, multi-line text sits in a fence longer than any backtick run in it,
 * and everything else is folded onto one line.
 */
export const LINE_BREAKS: RegExp = /\r\n|\r|\n|\u2028|\u2029/;

/** Control characters and line separators as spaces: the text stays on its line. */
export function oneLine(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: replacing them is the point.
  return text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ");
}

/** The longest run of backticks in `text`. */
export function longestBacktickRun(text: string): number {
  let longest = 0;
  for (const run of text.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return longest;
}

/** `text` as an inline code span that nothing inside can close. */
export function code(text: string): string {
  const line = oneLine(text);
  const ticks = "`".repeat(longestBacktickRun(line) + 1);
  const pad = line.startsWith("`") || line.endsWith("`") || line.trim() === "" ? " " : "";
  return `${ticks}${pad}${line}${pad}${ticks}`;
}

/** `text` as a JSON string: quoted, with its line breaks and controls escaped. */
export function quoted(text: string): string {
  return oneLine(JSON.stringify(text));
}
