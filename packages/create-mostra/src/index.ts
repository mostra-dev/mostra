/**
 * `create-mostra`, what `npm create mostra` runs (RT-01). It creates an artifact with `mostra new`
 * through the `@mostra/cli` it depends on, so the first run also installs the runtime bundle that
 * release pins (the CLI's bootstrap), then says what to run next. It adds no behavior of its own:
 * every flag but its own is the CLI's, and its exit code is the CLI's.
 *
 * @packageDocumentation
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";

/** The directory an artifact goes into when none is named. */
export const DEFAULT_DIR: string = "my-artifact";

/** What one run does: the `mostra` arguments, and the directory it creates. */
export interface CreatePlan {
  /** The arguments for `mostra`: `new <dir>` and the flags passed on. */
  readonly argv: readonly string[];
  /** The artifact's directory, absolute. */
  readonly dir: string;
  /** Whether `--json` was given: then stdout is exactly the CLI's envelope. */
  readonly json: boolean;
  /** Whether to print this package's usage instead. */
  readonly help: boolean;
}

/**
 * Plans a run from `npm create mostra [dir] -- [flags]`: the first argument that isn't a flag is
 * the directory (else {@link DEFAULT_DIR}); every flag goes to `mostra new` as given.
 */
export function plan(args: readonly string[], cwd: string): CreatePlan {
  let dir: string | undefined;
  const flags: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] as string;
    if (arg === "--") continue;
    if (arg.startsWith("-")) {
      flags.push(arg);
      // A flag with a value in the next argument: `--title "Q3 review"`.
      const next = args[index + 1];
      if (!arg.includes("=") && VALUED.has(arg) && next !== undefined) {
        flags.push(next);
        index++;
      }
    } else if (dir === undefined) dir = arg;
    else flags.push(arg);
  }
  const chosen = dir ?? DEFAULT_DIR;
  return {
    argv: ["new", chosen, ...flags],
    dir: resolve(cwd, chosen),
    json: flags.includes("--json"),
    help: flags.includes("--help") || flags.includes("-h"),
  };
}

/** `mostra new`'s flags (and the global ones) that take a value. */
const VALUED: ReadonlySet<string> = new Set([
  "--title",
  "--template",
  "--request-id",
  "--home",
  "--cwd",
  "--timeout",
]);

/** This package's usage. */
export const USAGE: string = `Create a Mostra artifact.

Usage: npm create mostra@latest [dir] -- [--title <text>] [--json]

  dir       The directory to create it in; it must be empty or not exist. Default: ${DEFAULT_DIR}
  --title   The artifact's title. Default: the directory's name.
  --json    Print only mostra's JSON envelope on stdout.

The first run downloads Mostra's runtime (about 200 MB), checks it and caches it; later runs reuse it.
Every flag is mostra new's: npx @mostra/cli new --help lists them.
`;

/** What to run next, for a person; `rel` is the artifact's directory as they'd type it. */
export function nextSteps(rel: string): string {
  const at = rel.includes(" ") ? JSON.stringify(rel) : rel;
  return `
Next:
  edit ${at}/index.tsx                     ordinary React; the agent writes it
  npx @mostra/cli verify ${at}             build it, render it and check it
  npx @mostra/cli publish ${at}            publish a version and print its link
  npm install --global @mostra/cli         for a plain \`mostra\` command

Docs: npx @mostra/cli docs
`;
}

/** The `mostra` binary of the `@mostra/cli` this package depends on. */
export function cliBin(): string {
  const require = createRequire(import.meta.url);
  const manifestPath = require.resolve("@mostra/cli/package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { bin?: { mostra?: string } };
  if (!manifest.bin?.mostra) throw new Error("@mostra/cli declares no mostra binary.");
  return join(dirname(manifestPath), manifest.bin.mostra);
}

/** How a run talks to the terminal. */
export interface CreateIo {
  /** The arguments after `create-mostra`, as `npm create mostra` passes them. */
  readonly args: readonly string[];
  /** The directory relative paths resolve from. */
  readonly cwd: string;
  /** The environment the CLI runs with. */
  readonly env: NodeJS.ProcessEnv;
  /** Writes to stdout: the usage and the next steps (the CLI writes its own output itself). */
  readonly stdout: (text: string) => void;
}

/** Runs `npm create mostra`: resolves with the exit code, the CLI's own. */
export async function create(io: CreateIo): Promise<number> {
  const run = plan(io.args, io.cwd);
  if (run.help) {
    io.stdout(USAGE);
    return 0;
  }
  const code = await new Promise<number>((done) => {
    const child = spawn(process.execPath, [cliBin(), ...run.argv], {
      cwd: io.cwd,
      env: io.env,
      stdio: "inherit",
    });
    const forward = (signal: NodeJS.Signals): void => {
      child.kill(signal);
    };
    process.on("SIGINT", forward);
    process.on("SIGTERM", forward);
    child.on("error", () => done(3));
    child.on("exit", (exit, signal) => {
      process.off("SIGINT", forward);
      process.off("SIGTERM", forward);
      done(exit ?? (signal === "SIGINT" ? 130 : 1));
    });
  });
  if (code === 0 && !run.json) io.stdout(nextSteps(relative(io.cwd, run.dir) || "."));
  return code;
}
