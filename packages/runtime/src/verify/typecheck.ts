/**
 * The type check (D138 item 8): TypeScript 7 `tsc --noEmit` over an artifact's snapshot, in a
 * child the process manager starts and records, beside the build and inside its 180 s. Imports
 * resolve as the build resolves them: the same `node_modules` layout (the warm set or the lock
 * layout), `@/*` at the snapshot's root, `@mostra/react`'s and `@mostra/server`'s types and the
 * generated live-source declaration. MDX isn't checked.
 *
 * The check runs in a directory of its own (a copy of the snapshot with the layout linked beside
 * it), so it never races the builder, which links its own `node_modules` into the staging root.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { cp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createDiagnostic, type Diagnostic } from "@mostra/protocol";
import { LIVE_DECLARATION } from "../builder/index.ts";
import { runtimeRoot } from "../deps/index.ts";
import type { Environment, Log } from "../log.ts";
import type { ProcessManager } from "../processes/index.ts";

/** How long the check may take: the build's own limit, which it runs beside (FAILURE_MODEL §9). */
export const TYPECHECK_TIMEOUT_MS = 180_000;

/**
 * How the build compiles, which every check starts from, under an artifact's own `tsconfig.json`
 * too: its options override these (Opus review finding 2: without them a `tsconfig.json` that
 * sets only `strict` failed every JSX file the build compiles).
 */
const BUILD_OPTIONS = {
  target: "ES2022",
  lib: ["ES2023", "DOM", "DOM.Iterable"],
  jsx: "react-jsx",
  module: "ESNext",
  isolatedModules: true,
  allowImportingTsExtensions: true,
  resolveJsonModule: true,
  allowJs: true,
  checkJs: false,
  // Server code runs in Node (D18): its modules see Node's types.
  types: ["node"],
};

/** What an artifact without a `tsconfig.json` is checked with besides (D138 item 8). */
const DEFAULT_OPTIONS = {
  strict: true,
  noUnusedLocals: false,
  noUnusedParameters: false,
};

/**
 * The options Mostra's check always sets, over an artifact's own `tsconfig.json` too. `baseUrl`
 * is cleared: the build doesn't use it and TypeScript 7 refuses it (TS5102), so a configuration
 * copied from a TypeScript 5 project (shadcn's Vite setup has one) checks like the build builds.
 */
const FORCED_OPTIONS = {
  noEmit: true,
  skipLibCheck: true,
  // The build is a bundler: it resolves and emits modules as one, whatever `module` says.
  module: "ESNext",
  moduleResolution: "bundler",
  baseUrl: null,
  paths: { "@/*": ["./source/*"] },
};

/** Vite's own declarations of what imports are (assets, CSS modules, `?raw`, `import.meta`). */
function viteClientTypes(): { readonly path: string; readonly version: string } | undefined {
  try {
    const require = createRequire(import.meta.url);
    const manifest = require.resolve("vite/package.json");
    const version = (JSON.parse(readFileSync(manifest, "utf8")) as { version: string }).version;
    const path = join(dirname(manifest), "client.d.ts");
    return existsSync(path) ? { path, version } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * What the files a build bundles are, for the checker: Vite's own client declarations for the
 * pinned release (every asset type, CSS modules as class maps, `?raw`, `?url`, `?inline`,
 * `?worker`, `import.meta.env`, `.glob` and `.hot`; Opus review finding 2), and MDX, which
 * Mostra's build adds.
 */
const VITE_CLIENT = viteClientTypes();
const AMBIENT = `// Written by Mostra for verify's type check (D138): what the build's imports are.
${VITE_CLIENT ? `/// <reference path=${JSON.stringify(VITE_CLIENT.path)} />\n` : ""}declare module "*.mdx" {
  const Content: (props: Record<string, unknown>) => unknown;
  export default Content;
  export const frontmatter: Record<string, unknown>;
}
`;

/**
 * The check configuration's revision: its text, so a change to what verify checks never reuses a
 * verdict made under the old rules (D138 items 5 and 8).
 */
export const TYPECHECK_REVISION: string = createHash("sha256")
  .update(
    JSON.stringify({
      BUILD_OPTIONS,
      DEFAULT_OPTIONS,
      FORCED_OPTIONS,
      // The declarations' text without this machine's path to them.
      AMBIENT: AMBIENT.replace(VITE_CLIENT?.path ?? "\u0000", "vite/client.d.ts"),
      vite: VITE_CLIENT?.version ?? null,
      revision: 2,
    }),
  )
  .digest("hex");

/** Where TypeScript 7's `tsc` is. */
function tscPath(): string {
  const require = createRequire(import.meta.url);
  return join(dirname(require.resolve("typescript/package.json")), "bin", "tsc");
}

/** One line of `tsc --pretty false`: `file(line,col): error TS1234: message`. */
const LINE = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;
/** A diagnostic without a file: `error TS5023: Unknown compiler option …`. */
const GLOBAL = /^error (TS\d+): (.*)$/;
/** The configuration files of a check: Mostra's, which extends the artifact's own. */
const CONFIG_FILES = new Set([
  "tsconfig.verify.json",
  ".mostra-check/build.json",
  "source/tsconfig.json",
]);

/** What the check found. */
export interface TypecheckOutcome {
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Turns `tsc`'s output into diagnostics: errors in the artifact's own files only, TS7016 as an
 * untyped package (a warning), and a TS2307 for an import `alreadyReported` names dropped.
 */
export function parseTscOutput(
  lines: readonly string[],
  alreadyReported: (specifier: string) => boolean,
  /** Whether the artifact has its own `tsconfig.json`, which Mostra's configuration extends. */
  ownConfig = false,
): Diagnostic[] {
  const found: { file: string; line: number; column: number; code: string; text: string }[] = [];
  for (const line of lines) {
    const match = LINE.exec(line);
    const global = match ? undefined : GLOBAL.exec(line);
    if (global) {
      found.push({
        file: "",
        line: 1,
        column: 1,
        code: global[1] as string,
        text: global[2] as string,
      });
    } else if (match) {
      found.push({
        file: match[1] as string,
        line: Number(match[2]),
        column: Number(match[3]),
        code: match[4] as string,
        text: match[5] as string,
      });
    } else if (/^\s+\S/.test(line) && found.length > 0) {
      const last = found[found.length - 1] as (typeof found)[number];
      if (last.text.length < 1500) last.text = `${last.text}\n${line.trim()}`;
    }
  }
  const diagnostics: Diagnostic[] = [];
  for (const entry of found) {
    const file = entry.file.replace(/\\/g, "/");
    // A configuration the compiler refuses means the source was never checked: an error, never
    // a pass (it is the artifact's `tsconfig.json` against how Mostra builds, D138 item 8).
    if (file === "" || CONFIG_FILES.has(file)) {
      diagnostics.push(
        createDiagnostic("MOSTRA_TYPE_ERROR", {
          message: `The type check couldn't run with the artifact's tsconfig.json and Mostra's build settings (noEmit, skipLibCheck, moduleResolution "bundler", the @/* path): ${entry.code}: ${entry.text}`,
          // The compiler reports options it inherits against the file that extends them, so an
          // artifact with its own configuration is pointed at it.
          ...(file === "source/tsconfig.json"
            ? { location: { file: "tsconfig.json", line: entry.line, column: entry.column } }
            : ownConfig
              ? { location: { file: "tsconfig.json", line: 1, column: 1 } }
              : {}),
        }),
      );
      continue;
    }
    if (!file.startsWith("source/") || file.includes("/node_modules/")) continue;
    const location = { file: file.slice("source/".length), line: entry.line, column: entry.column };
    if (entry.code === "TS7016") {
      diagnostics.push(
        createDiagnostic("MOSTRA_TYPE_UNTYPED_PACKAGE", {
          message: `${entry.text} (${entry.code})`,
          location,
        }),
      );
      continue;
    }
    if (entry.code === "TS2307") {
      const specifier = /'([^']+)'/.exec(entry.text)?.[1];
      if (specifier !== undefined && alreadyReported(specifier)) continue;
    }
    diagnostics.push(
      createDiagnostic("MOSTRA_TYPE_ERROR", {
        message: `${entry.code}: ${entry.text}`,
        location,
      }),
    );
  }
  return diagnostics;
}

/** Where `@mostra/server`'s declarations are: the worker provides the package, so no layout has it (D129). */
function serverTypes(): string | undefined {
  const root = runtimeRoot();
  for (const candidate of [
    join(root, "..", "server", "dist", "index.d.ts"),
    join(root, "..", "server", "src", "index.ts"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** Runs the type check of the snapshot in `sourceDir` against `nodeModules`. */
export async function typecheck(options: {
  readonly processes: ProcessManager;
  readonly log: Log;
  readonly env: Environment;
  /** The snapshot (staging's `source/`). */
  readonly sourceDir: string;
  /** A fresh directory the check may use, removed afterwards. */
  readonly workDir: string;
  /** The layout the build links: the warm set or the artifact's lock layout. */
  readonly nodeModules: string;
  /** Whether the artifact has `live.ts` (D56). */
  readonly hasLive: boolean;
  /** Whether a TS2307 for this import repeats what the build or dependency stage said. */
  readonly alreadyReported: (specifier: string) => boolean;
  readonly timeoutMs?: number;
}): Promise<TypecheckOutcome> {
  const { workDir } = options;
  await rm(workDir, { recursive: true, force: true });
  await mkdir(join(workDir, ".mostra-check"), { recursive: true });
  try {
    await cp(options.sourceDir, join(workDir, "source"), { recursive: true });
    await symlink(options.nodeModules, join(workDir, "node_modules"), "dir");
    await writeFile(join(workDir, ".mostra-check", "assets.d.ts"), AMBIENT);
    if (options.hasLive)
      await writeFile(join(workDir, ".mostra-check", "mostra-env.d.ts"), LIVE_DECLARATION);
    const own = existsSync(join(workDir, "source", "tsconfig.json"));
    const server = serverTypes();
    const forced = {
      ...FORCED_OPTIONS,
      paths: { ...FORCED_OPTIONS.paths, ...(server ? { "@mostra/server": [server] } : {}) },
    };
    // The build's options first, the artifact's own configuration over them, Mostra's forced
    // ones last (an `extends` array applies in order).
    await writeFile(
      join(workDir, ".mostra-check", "build.json"),
      `${JSON.stringify({ compilerOptions: own ? BUILD_OPTIONS : { ...BUILD_OPTIONS, ...DEFAULT_OPTIONS } }, null, 2)}\n`,
    );
    const config = {
      extends: own
        ? ["./.mostra-check/build.json", "./source/tsconfig.json"]
        : "./.mostra-check/build.json",
      compilerOptions: forced,
      include: ["source/**/*.ts", "source/**/*.tsx", ".mostra-check/*.d.ts"],
      exclude: ["source/**/node_modules"],
    };
    await writeFile(join(workDir, "tsconfig.verify.json"), `${JSON.stringify(config, null, 2)}\n`);
    const lines: string[] = [];
    const child = await options.processes.spawn({
      kind: "typecheck",
      ownerRef: workDir,
      command: process.execPath,
      args: [tscPath(), "-p", "tsconfig.verify.json", "--noEmit", "--pretty", "false"],
      cwd: workDir,
      env: {
        PATH: options.env["PATH"] ?? "/usr/bin:/bin",
        HOME: options.env["HOME"] ?? "/",
        ...(options.env["TMPDIR"] ? { TMPDIR: options.env["TMPDIR"] } : {}),
      },
      onStdout: (line) => {
        if (lines.length < 5000) lines.push(line);
      },
    });
    const timeoutMs = options.timeoutMs ?? TYPECHECK_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const exit = await Promise.race([
      child.exited,
      new Promise<"timeout">((done) => {
        timer = setTimeout(() => done("timeout"), timeoutMs);
      }),
    ]);
    if (timer) clearTimeout(timer);
    if (exit === "timeout") {
      await child.stop(2000);
      options.log.warn("verify.typecheck_timeout", { timeoutMs });
      return {
        diagnostics: [
          createDiagnostic("MOSTRA_VERIFY_TIMEOUT", {
            message: `The type check took longer than ${Math.round(timeoutMs / 1000)} s and was stopped.`,
          }),
        ],
      };
    }
    const diagnostics = parseTscOutput(lines, options.alreadyReported, own);
    return { diagnostics: [...diagnostics, ...unexplainedExit(exit, lines, diagnostics)] };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

/** Whether the build's diagnostics already name a module the type check couldn't find. */
export function reportedByBuild(diagnostics: readonly Diagnostic[], specifier: string): boolean {
  return diagnostics.some(
    (diagnostic) =>
      diagnostic.message.includes(`"${specifier}"`) ||
      diagnostic.message.includes(`'${specifier}'`) ||
      diagnostic.message.includes(`\`${specifier}\``),
  );
}

/**
 * What a `tsc` exit says beyond the diagnostics it printed: a signal is a crash of the checker
 * (never cached), and a failing exit with no error found means the source wasn't checked, which
 * fails closed (an error) instead of passing.
 */
export function unexplainedExit(
  exit: {
    readonly code: number | null;
    readonly signal: string | null;
    readonly stderrTail: readonly string[];
  },
  lines: readonly string[],
  found: readonly Diagnostic[],
): Diagnostic[] {
  const tail = [...lines, ...exit.stderrTail]
    .filter((line) => line.trim() !== "")
    .slice(-6)
    .join("\n");
  if (exit.signal !== null) {
    return [
      createDiagnostic("MOSTRA_VERIFY_CRASHED", {
        message: `The type checker stopped (${exit.signal}) before it finished.${tail ? `\n${tail}` : ""}`,
      }),
    ];
  }
  if (exit.code !== 0 && !found.some((diagnostic) => diagnostic.severity === "error")) {
    return [
      createDiagnostic("MOSTRA_TYPE_ERROR", {
        message: `The type check exited with code ${exit.code} without checking the source${tail ? `:\n${tail}` : "."}`,
      }),
    ];
  }
  return [];
}
