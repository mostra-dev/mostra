/**
 * The type check (D137 item 8): TypeScript 7 `tsc --noEmit` over an artifact's snapshot, in a
 * child the process manager starts and records, beside the build and inside its 180 s. Imports
 * resolve as the build resolves them: the same `node_modules` layout (the warm set or the lock
 * layout), `@/*` at the snapshot's root, `@mostra/react`'s and `@mostra/server`'s types and the
 * generated live-source declaration. MDX isn't checked.
 *
 * The check runs in a directory of its own (a copy of the snapshot with the layout linked beside
 * it), so it never races the builder, which links its own `node_modules` into the staging root.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
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

/** The options Mostra sets when the artifact has no `tsconfig.json` (D137 item 8). */
const DEFAULT_OPTIONS = {
  strict: true,
  noUnusedLocals: false,
  noUnusedParameters: false,
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

/** The options Mostra's check always sets, over an artifact's own `tsconfig.json` too. */
const FORCED_OPTIONS = {
  noEmit: true,
  skipLibCheck: true,
  moduleResolution: "bundler",
  paths: { "@/*": ["./source/*"] },
};

/** What the files a build bundles are, for the checker: Vite's asset and MDX imports. */
const AMBIENT = `// Written by Mostra for verify's type check (D137): what the build's imports are.
declare module "*.css" { const css: string; export default css; }
declare module "*.svg" { const src: string; export default src; }
declare module "*.png" { const src: string; export default src; }
declare module "*.jpg" { const src: string; export default src; }
declare module "*.jpeg" { const src: string; export default src; }
declare module "*.gif" { const src: string; export default src; }
declare module "*.webp" { const src: string; export default src; }
declare module "*.avif" { const src: string; export default src; }
declare module "*.ico" { const src: string; export default src; }
declare module "*.woff" { const src: string; export default src; }
declare module "*.woff2" { const src: string; export default src; }
declare module "*.mp4" { const src: string; export default src; }
declare module "*.webm" { const src: string; export default src; }
declare module "*.mp3" { const src: string; export default src; }
declare module "*.wav" { const src: string; export default src; }
declare module "*.txt" { const text: string; export default text; }
declare module "*?raw" { const text: string; export default text; }
declare module "*?url" { const src: string; export default src; }
declare module "*.mdx" {
  const Content: (props: Record<string, unknown>) => unknown;
  export default Content;
  export const frontmatter: Record<string, unknown>;
}
interface ImportMetaEnv { readonly [key: string]: string | boolean | undefined }
interface ImportMeta { readonly env: ImportMetaEnv }
`;

/**
 * The check configuration's revision: its text, so a change to what verify checks never reuses a
 * verdict made under the old rules (D137 items 5 and 8).
 */
export const TYPECHECK_REVISION: string = createHash("sha256")
  .update(JSON.stringify({ DEFAULT_OPTIONS, FORCED_OPTIONS, AMBIENT, revision: 1 }))
  .digest("hex");

/** Where TypeScript 7's `tsc` is. */
function tscPath(): string {
  const require = createRequire(import.meta.url);
  return join(dirname(require.resolve("typescript/package.json")), "bin", "tsc");
}

/** One line of `tsc --pretty false`: `file(line,col): error TS1234: message`. */
const LINE = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;

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
): Diagnostic[] {
  const found: { file: string; line: number; column: number; code: string; text: string }[] = [];
  for (const line of lines) {
    const match = LINE.exec(line);
    if (match) {
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
    const config = {
      ...(own ? { extends: "./source/tsconfig.json" } : {}),
      compilerOptions: own ? forced : { ...DEFAULT_OPTIONS, ...forced },
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
    return { diagnostics: parseTscOutput(lines, options.alreadyReported) };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
