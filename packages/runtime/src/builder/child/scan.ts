/**
 * The builder child's static scan of an artifact (INTERFACES §11): its `"use server"` modules with
 * their exports and `dryRun()` opt-ins (D54, D55), the live sources of `live.ts` (D56) and the
 * routes of `pages/` (D57). Parsing only; nothing in the artifact runs.
 */
import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { createDiagnostic, type Diagnostic } from "@mostra/protocol";
import { parseSync } from "oxc-parser";
import type { FieldCoverage } from "../coverage.ts";
import type { PageRoute, ServerFunctionEntry } from "../types.ts";
import { scanFields } from "./fields.ts";

interface Node {
  readonly type: string;
  readonly start: number;
  readonly end: number;
  readonly [key: string]: unknown;
}

/** Every script extension the bundler loads; a "use server" module may have any of them. */
export const SCRIPT: ReadonlySet<string> = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

/** Oxc's language for a script file. */
function langOf(file: string): "ts" | "tsx" | "js" | "jsx" {
  const ext = extname(file);
  if (ext === ".tsx") return "tsx";
  if (ext === ".jsx") return "jsx";
  if (ext === ".ts" || ext === ".mts" || ext === ".cts") return "ts";
  return "js";
}

/**
 * Whether a script starts with the `"use server"` directive. `undefined` when it doesn't parse:
 * the bundler, which parses the same way, then reports the syntax error.
 */
export function startsWithUseServer(file: string, text: string): boolean | undefined {
  if (!text.includes("use server")) return false;
  const parsed = parseSync(file, text, { lang: langOf(file) });
  if (parsed.errors.length > 0) return undefined;
  return isServerModule(parsed.program as unknown as Node);
}
const PAGE = new Set([".tsx", ".jsx", ".mdx"]);
const SERVER_PACKAGE = "@mostra/server";

/** What the scan found. */
export interface ScanResult {
  /** `"use server"` modules (paths inside the artifact) with their exports. */
  readonly serverModules: ReadonlyMap<string, readonly ServerFunctionEntry[]>;
  readonly liveSources: readonly { readonly key: string; readonly always?: boolean }[];
  readonly hasLive: boolean;
  readonly pages: readonly PageRoute[];
  /** The field IDs the artifact's own code can use (D109). */
  readonly fields: FieldCoverage;
  readonly diagnostics: readonly Diagnostic[];
  /**
   * Server-code candidates (a script naming `"use server"`, or `live.ts`) that don't parse. A
   * build's bundler reports them with full context; `mostra dev`, which bundles server code only
   * from what the scan found, reports them itself.
   */
  readonly unparsed: readonly Diagnostic[];
}

async function walk(dir: string, prefix: string, out: string[]): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await walk(join(dir, entry.name), path, out);
    else if (entry.isFile()) out.push(path);
  }
}

function lineColumn(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  const line = before.split("\n").length;
  return { line, column: offset - before.lastIndexOf("\n") };
}

/** Calls each child node of `node`. */
function children(node: Node, visit: (child: Node, parent: Node, key: string) => void): void {
  for (const [key, value] of Object.entries(node)) {
    if (Array.isArray(value)) {
      for (const item of value)
        if (item && typeof item === "object" && "type" in item) visit(item as Node, node, key);
    } else if (value && typeof value === "object" && "type" in value) {
      visit(value as Node, node, key);
    }
  }
}

/** Whether the module starts with the `"use server"` directive. */
function isServerModule(program: Node): boolean {
  for (const statement of program["body"] as Node[]) {
    if (statement.type !== "ExpressionStatement" || typeof statement["directive"] !== "string")
      return false;
    if (statement["directive"] === "use server") return true;
  }
  return false;
}

/** TypeScript wrappers that compile away: `as`, `satisfies`, `!`, `<T>x` and parentheses. */
const ERASED_WRAPPERS = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
  "TSInstantiationExpression",
  "ParenthesizedExpression",
]);

/** The expression a wrapper chain wraps: `(async () => 1) satisfies F` is the arrow function. */
function unwrap(node: Node | undefined): Node | undefined {
  let current = node;
  while (current !== undefined && ERASED_WRAPPERS.has(current.type)) {
    current = current["expression"] as Node | undefined;
  }
  return current;
}

const isAsyncFunction = (node: Node | undefined): boolean => {
  const target = unwrap(node);
  return (
    target !== undefined &&
    (target.type === "FunctionDeclaration" ||
      target.type === "FunctionExpression" ||
      target.type === "ArrowFunctionExpression") &&
    target["async"] === true
  );
};

/**
 * Declarations that exist only for the type checker: types, interfaces, overload signatures and
 * anything `declare`d. Enums and namespaces are values at run time, so they are not among them.
 */
const isErasedDeclaration = (node: Node): boolean =>
  node["declare"] === true ||
  node.type === "TSTypeAliasDeclaration" ||
  node.type === "TSInterfaceDeclaration" ||
  node.type === "TSDeclareFunction";

/**
 * Reads one `"use server"` module: every export must be an async function (React's contract),
 * and an export opts into `verify`'s smoke test when it, or a module-level function it calls,
 * calls `dryRun()` from `@mostra/server` (D55).
 */
function serverExports(
  module: string,
  text: string,
  program: Node,
  diagnostics: Diagnostic[],
): ServerFunctionEntry[] {
  const dryRunNames = new Set<string>();
  const namespaces = new Set<string>();
  const functions = new Map<string, Node>();
  const exported: { name: string; local: Node | undefined; at: number }[] = [];
  const invalid = (at: number, message: string): void => {
    diagnostics.push(
      createDiagnostic("MOSTRA_ACTION_EXPORT_INVALID", {
        message,
        location: { file: module, ...lineColumn(text, at) },
      }),
    );
  };

  const remember = (declaration: Node): void => {
    if (declaration.type === "FunctionDeclaration" && declaration["id"]) {
      functions.set((declaration["id"] as Node)["name"] as string, declaration);
    }
    if (declaration.type === "VariableDeclaration") {
      for (const declarator of declaration["declarations"] as Node[]) {
        const id = declarator["id"] as Node;
        if (id.type === "Identifier" && declarator["init"]) {
          functions.set(id["name"] as string, declarator["init"] as Node);
        }
      }
    }
  };

  for (const statement of program["body"] as Node[]) {
    if (
      statement.type === "ImportDeclaration" &&
      (statement["source"] as Node)["value"] === SERVER_PACKAGE
    ) {
      for (const specifier of statement["specifiers"] as Node[]) {
        const local = (specifier["local"] as Node)["name"] as string;
        if (specifier.type === "ImportNamespaceSpecifier") namespaces.add(local);
        const imported = specifier["imported"] as Node | undefined;
        if (
          specifier.type === "ImportSpecifier" &&
          (imported?.["name"] ?? imported?.["value"]) === "dryRun"
        ) {
          dryRunNames.add(local);
        }
      }
    } else if (statement.type === "ExportNamedDeclaration") {
      if (statement["exportKind"] === "type") continue;
      if (statement["source"]) {
        invalid(
          statement.start,
          `${module} re-exports from another module; a "use server" module exports only its own async functions.`,
        );
        continue;
      }
      const declaration = statement["declaration"] as Node | null;
      if (declaration) {
        if (isErasedDeclaration(declaration)) continue;
        remember(declaration);
        if (declaration.type === "FunctionDeclaration") {
          const name = (declaration["id"] as Node)["name"] as string;
          exported.push({ name, local: declaration, at: declaration.start });
        } else if (declaration.type === "VariableDeclaration") {
          for (const declarator of declaration["declarations"] as Node[]) {
            const id = declarator["id"] as Node;
            exported.push({
              name: id.type === "Identifier" ? (id["name"] as string) : "(pattern)",
              local: (declarator["init"] as Node | null) ?? undefined,
              at: declarator.start,
            });
          }
        } else {
          exported.push({ name: "(declaration)", local: declaration, at: declaration.start });
        }
      }
      for (const specifier of (statement["specifiers"] as Node[]) ?? []) {
        if (specifier["exportKind"] === "type") continue;
        const name = ((specifier["exported"] as Node)["name"] ??
          (specifier["exported"] as Node)["value"]) as string;
        const local = (specifier["local"] as Node)["name"] as string;
        exported.push({
          name,
          local: { type: "Ref", start: specifier.start, end: specifier.end, name: local },
          at: specifier.start,
        });
      }
    } else if (statement.type === "ExportDefaultDeclaration") {
      const declaration = statement["declaration"] as Node;
      if (declaration.type === "FunctionDeclaration" && declaration["id"]) remember(declaration);
      exported.push({
        name: "default",
        local:
          declaration.type === "Identifier"
            ? {
                type: "Ref",
                start: declaration.start,
                end: declaration.end,
                name: declaration["name"],
              }
            : declaration,
        at: statement.start,
      });
    } else if (statement.type === "ExportAllDeclaration") {
      invalid(
        statement.start,
        `${module} re-exports with \`export *\`; a "use server" module exports only its own async functions.`,
      );
    } else if (!isErasedDeclaration(statement)) {
      remember(statement);
    }
  }

  // Which module-level functions call dryRun(), directly or through other module-level functions.
  const calls = new Map<string, Set<string>>();
  const direct = new Set<string>();
  const scan = (node: Node, owner: string): void => {
    if (node.type === "CallExpression") {
      const callee = node["callee"] as Node;
      if (callee.type === "Identifier") {
        const name = callee["name"] as string;
        if (dryRunNames.has(name)) direct.add(owner);
        else calls.get(owner)?.add(name);
      } else if (
        callee.type === "MemberExpression" &&
        !callee["computed"] &&
        (callee["object"] as Node).type === "Identifier" &&
        namespaces.has((callee["object"] as Node)["name"] as string) &&
        (callee["property"] as Node)["name"] === "dryRun"
      ) {
        direct.add(owner);
      }
    }
    children(node, (child) => scan(child, owner));
  };
  for (const [name, node] of functions) {
    calls.set(name, new Set());
    scan(node, name);
  }
  const optsIn = (name: string, seen = new Set<string>()): boolean => {
    if (direct.has(name)) return true;
    if (seen.has(name)) return false;
    seen.add(name);
    return [...(calls.get(name) ?? [])].some((callee) => optsIn(callee, seen));
  };

  const entries: ServerFunctionEntry[] = [];
  for (const { name, local, at } of exported) {
    // Follow `export const x = y` (and `y!`, `y as F`) to the function `y` names.
    let target = unwrap(local?.type === "Ref" ? functions.get(local["name"] as string) : local);
    const followed = new Set<string>();
    while (target?.type === "Identifier" && !followed.has(target["name"] as string)) {
      followed.add(target["name"] as string);
      target = unwrap(functions.get(target["name"] as string));
    }
    if (!isAsyncFunction(target)) {
      invalid(
        at,
        `The export \`${name}\` of ${module} isn't an async function; a "use server" module exports only async functions.`,
      );
      continue;
    }
    let dryRun: boolean;
    if (local?.type === "Ref") dryRun = optsIn(local["name"] as string);
    else {
      const owner = `export:${name}`;
      calls.set(owner, new Set());
      scan(target as Node, owner);
      dryRun = optsIn(owner);
    }
    entries.push({ id: `${module}#${name}`, module, export: name, dryRun });
  }
  return entries;
}

/**
 * Whether a `defineLive({ … })` argument says `always: true` (D63): `true` or `false` when the
 * object literal tells, `undefined` when it can't be known without running it (a spread, a
 * computed key, a value other than a literal, or no object literal at all).
 */
function literalAlways(argument: Node | undefined): boolean | undefined {
  if (argument?.type !== "ObjectExpression") return undefined;
  let always: boolean | undefined = false;
  for (const property of argument["properties"] as Node[]) {
    if (property.type !== "Property" || property["computed"] === true) {
      always = undefined;
      continue;
    }
    const key = property["key"] as Node;
    const name = key.type === "Identifier" ? key["name"] : key["value"];
    if (name !== "always") continue;
    const value = property["value"] as Node;
    always =
      value.type === "Literal" && typeof value["value"] === "boolean"
        ? (value["value"] as boolean)
        : undefined;
  }
  return always;
}

/** The exports of `live.ts` that are `defineLive(...)` calls (D56), with their literal `always`. */
function liveExports(program: Node): { key: string; always?: boolean }[] {
  const keys: { key: string; always?: boolean }[] = [];
  for (const statement of program["body"] as Node[]) {
    if (statement.type !== "ExportNamedDeclaration") continue;
    const declaration = statement["declaration"] as Node | null;
    if (declaration?.type !== "VariableDeclaration") continue;
    for (const declarator of declaration["declarations"] as Node[]) {
      const id = declarator["id"] as Node;
      const init = declarator["init"] as Node | null;
      const callee = init?.type === "CallExpression" ? (init["callee"] as Node) : undefined;
      const calleeName =
        callee?.type === "Identifier"
          ? callee["name"]
          : callee?.type === "MemberExpression"
            ? (callee["property"] as Node)["name"]
            : undefined;
      if (id.type === "Identifier" && calleeName === "defineLive") {
        const always = literalAlways((init?.["arguments"] as Node[] | undefined)?.[0]);
        keys.push({ key: id["name"] as string, ...(always === undefined ? {} : { always }) });
      }
    }
  }
  return keys;
}

/** `pages/reports/[id].tsx` → `/reports/:id`; `index` names its folder (D57). */
function routePath(file: string): string {
  const segments = file
    .slice("pages/".length, file.length - extname(file).length)
    .split("/")
    .filter((segment, index, all) => !(segment === "index" && index === all.length - 1))
    .map((segment) => {
      const rest = /^\[\.\.\.(.+)\]$/.exec(segment);
      if (rest) return "*";
      const param = /^\[(.+)\]$/.exec(segment);
      return param ? `:${param[1]}` : segment;
    });
  return `/${segments.join("/")}`;
}

/** Scans the snapshot in `sourceDir`. */
export async function scanArtifact(sourceDir: string): Promise<ScanResult> {
  const files: string[] = [];
  await walk(sourceDir, "", files);
  const diagnostics: Diagnostic[] = [];
  const serverModules = new Map<string, ServerFunctionEntry[]>();
  const unparsed: Diagnostic[] = [];
  let liveSources: { key: string; always?: boolean }[] = [];
  for (const file of files.sort()) {
    if (!SCRIPT.has(extname(file))) continue;
    const text = await readFile(join(sourceDir, file), "utf8");
    if (!text.includes("use server") && file !== "live.ts") continue;
    const parsed = parseSync(file, text, { lang: langOf(file) });
    if (parsed.errors.length > 0) {
      // The bundler reports syntax errors with full context; dev reports them from here.
      const first = parsed.errors[0];
      const offset = first?.labels[0]?.start ?? 0;
      const before = text.slice(0, offset).split("\n");
      unparsed.push(
        createDiagnostic("MOSTRA_BUILD_FAILED", {
          message: `${file}: ${first?.message ?? "a syntax error"}.`,
          location: {
            file,
            line: before.length,
            column: (before.at(-1)?.length ?? 0) + 1,
          },
        }),
      );
      continue;
    }
    const program = parsed.program as unknown as Node;
    if (file === "live.ts") liveSources = liveExports(program);
    if (isServerModule(program))
      serverModules.set(file, serverExports(file, text, program, diagnostics));
  }
  const pages = files
    .filter((file) => file.startsWith("pages/") && PAGE.has(extname(file)))
    .sort()
    .map((file) => ({ path: routePath(file), file }));
  const byPath = new Map<string, string>();
  for (const page of pages) {
    const other = byPath.get(page.path);
    if (other) {
      diagnostics.push(
        createDiagnostic("MOSTRA_BUILD_FAILED", {
          message: `${other} and ${page.file} are both the page ${page.path}; keep one.`,
          location: { file: page.file, line: 1, column: 1 },
        }),
      );
    }
    byPath.set(page.path, page.file);
  }
  const fields = await scanFields(sourceDir, files);
  return {
    serverModules,
    liveSources,
    hasLive: files.includes("live.ts"),
    pages,
    fields,
    diagnostics,
    unparsed,
  };
}
