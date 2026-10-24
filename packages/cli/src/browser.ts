/**
 * Opening a browser on a launch URL without putting it on a command line (D140 item 15, Opus
 * review finding 4). A program's arguments are readable by every local user (`ps`,
 * `/proc/<pid>/cmdline`), so the opener gets the path of a page that redirects to the launch URL,
 * written mode 0600 in a fresh directory of mode 0700, as Jupyter's server does for its token.
 * Windows has no modes: there the page goes under the user's own profile
 * (`%LOCALAPPDATA%\mostra-cli\open`), whose access list only the user, `SYSTEM` and
 * administrators pass, never under `%TEMP%`, which may name a folder other users can read (Opus
 * review of WP-W2, finding 1). The launch ticket in the page is single-use and lives a minute, so a
 * page left behind is harmless; each launch removes the ones older than that.
 */
import { spawn } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, win32 } from "node:path";
import type { Environment } from "./home.ts";

/** The prefix of the directories launch pages live in. */
const PREFIX = "mostra-open-";
/** A launch page older than this holds a ticket that expired: it goes on the next launch. */
const STALE_MS = 2 * 60_000;

/** Escapes text for an HTML attribute or element. */
const html = (text: string): string =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

/** The page that sends the browser on to `url`. */
export function launchPage(url: string): string {
  // JSON in a script, with `<` escaped so nothing in it ends the script element.
  const script = JSON.stringify(url).replaceAll("<", "\\u003c");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<meta http-equiv="refresh" content="0;url=${html(url)}">
<title>Opening Mostra</title>
<script>location.replace(${script});</script>
</head>
<body>
<p>Opening the artifact. If nothing happens, <a href="${html(url)}">open it here</a>.</p>
</body>
</html>
`;
}

/** Removes launch pages of earlier launches that are this user's and older than a minute or two. */
function sweep(base: string, now: number): void {
  const uid = process.getuid?.();
  let names: string[];
  try {
    names = readdirSync(base);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.startsWith(PREFIX)) continue;
    const dir = join(base, name);
    try {
      const stats = lstatSync(dir);
      if (!stats.isDirectory() || (uid !== undefined && stats.uid !== uid)) continue;
      if (now - stats.mtimeMs < STALE_MS) continue;
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Gone already, or not ours to remove.
    }
  }
}

/** Writes the launch page for `url`; its path. */
export function writeLaunchPage(
  url: string,
  base: string = tmpdir(),
  now: number = Date.now(),
): string {
  sweep(base, now);
  // mkdtemp makes the directory with a random name and mode 0700.
  const dir = mkdtempSync(join(base, PREFIX));
  const file = join(dir, "open.html");
  writeFileSync(file, launchPage(url), { mode: 0o600, flag: "wx" });
  return file;
}

/**
 * Splits a command the way a shell would split plain words and quotes, without running one:
 * `firefox --new-window %s` or `"/Applications/My Browser" %s`.
 */
export function splitCommand(command: string): string[] {
  const words: string[] = [];
  let word = "";
  let inWord = false;
  let quote: '"' | "'" | undefined;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index] as string;
    if (quote) {
      if (char === quote) quote = undefined;
      else if (char === "\\" && quote === '"' && index + 1 < command.length) {
        index += 1;
        word += command[index];
      } else word += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      inWord = true;
    } else if (char === "\\" && index + 1 < command.length) {
      index += 1;
      word += command[index];
      inWord = true;
    } else if (/\s/.test(char)) {
      if (inWord) words.push(word);
      word = "";
      inWord = false;
    } else {
      word += char;
      inWord = true;
    }
  }
  if (inWord) words.push(word);
  return words;
}

/** The program that opens a file with its default application, by platform. */
function platformOpener(platform: string): string[] {
  if (platform === "darwin") return ["open"];
  // Explorer opens a path with the program associated with its type, `.html` with the default
  // browser, as a double click would (VERIFIED_FACTS, WP-W2); its arguments go to it directly,
  // never through `cmd`.
  if (platform === "win32") return ["explorer.exe"];
  return ["xdg-open"];
}

/**
 * Splits a command as Windows programs read their command lines, for `$BROWSER` there: words
 * separated by spaces, double quotes grouping words with spaces (`"C:\Program Files\Firefox\
 * firefox.exe" %s`), and backslashes kept as they are.
 */
export function splitWindowsCommand(command: string): string[] {
  const words: string[] = [];
  let word = "";
  let inWord = false;
  let quoted = false;
  for (const char of command) {
    if (char === '"') {
      quoted = !quoted;
      inWord = true;
    } else if (!quoted && /\s/.test(char)) {
      if (inWord) words.push(word);
      word = "";
      inWord = false;
    } else {
      word += char;
      inWord = true;
    }
  }
  if (inWord) words.push(word);
  return words;
}

/**
 * The commands that may open `target`, in order: each entry of `$BROWSER` (separated by the
 * platform's path delimiter, `:` or `;` on Windows, its `%s` replaced by the target, else the
 * target appended, `%%` a literal `%`, as `xdg-open` and Python's `webbrowser` read it), else the
 * platform's opener.
 */
export function browserCommands(
  target: string,
  env: Environment,
  platform: string = process.platform,
): string[][] {
  const chosen = env["BROWSER"];
  if (chosen === undefined || chosen.trim() === "") return [[...platformOpener(platform), target]];
  const entries = chosen
    .split(platform === "win32" ? ";" : ":")
    .filter((entry) => entry.trim() !== "");
  const commands: string[][] = [];
  for (const entry of entries) {
    // A Windows path's backslashes are separators, never escapes.
    const words = platform === "win32" ? splitWindowsCommand(entry) : splitCommand(entry);
    if (words.length === 0) continue;
    let substituted = false;
    const argv = words.map((word) =>
      word.replaceAll(/%%|%s/g, (match) => {
        if (match === "%%") return "%";
        substituted = true;
        return target;
      }),
    );
    commands.push(substituted ? argv : [...argv, target]);
  }
  return commands;
}

/** Starts one command, detached; whether it started (its program was found and could run). */
function start(argv: readonly string[]): Promise<boolean> {
  const [program, ...args] = argv;
  if (program === undefined) return Promise.resolve(false);
  return new Promise((resolve) => {
    try {
      const child = spawn(program, args, { detached: true, stdio: "ignore" });
      child.once("spawn", () => {
        child.unref();
        resolve(true);
      });
      child.once("error", () => resolve(false));
    } catch {
      resolve(false);
    }
  });
}

/**
 * Where launch pages go: the system's temporary directory on POSIX (the page's modes protect it),
 * the user's own profile on Windows, whatever `%TEMP%` names.
 */
export function launchBase(env: Environment, platform: string = process.platform): string {
  if (platform !== "win32") return tmpdir();
  const local = env["LOCALAPPDATA"];
  const base =
    local !== undefined && local !== "" && win32.isAbsolute(local)
      ? local
      : win32.join(homedir(), "AppData", "Local");
  return win32.join(base, "mostra-cli", "open");
}

/** Opens `url` in a browser through a launch page; whether a browser command started. */
export async function openInBrowser(url: string, env: Environment): Promise<boolean> {
  let page: string;
  try {
    const base = launchBase(env);
    mkdirSync(base, { recursive: true, mode: 0o700 });
    page = writeLaunchPage(url, base);
  } catch {
    return false;
  }
  for (const command of browserCommands(page, env)) {
    if (await start(command)) return true;
  }
  return false;
}
