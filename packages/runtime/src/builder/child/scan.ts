/**
 * The builder child's static scan of an artifact (INTERFACES §11): its `"use server"` modules with
 * their exports and `dryRun()` opt-ins (D54, D55), the live sources of `live.ts` (D56) and the
 * routes of `pages/` (D57). Parsing only; nothing in the artifact runs.
 */
import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { createDiagnostic, type Diagnostic } from "@mostra/protocol";
import { parseSync } from "oxc-parser";
import type { PageRoute, ServerFunctionEntry } from "../types.ts";

interface Node {
  readonly type: string;
  readonly start: number;
  readonly end: number;
  readonly [key: string]: unknown;
}

const SCRIPT = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs"]);
const PAGE = new Set([".tsx", ".jsx", ".mdx"]);
const SERVER_PACKAGE = "@mostra/server";

/** What the scan found. */
export interface ScanResult {
  /** `"use server"` modules (paths inside the artifact) with their exports. */
  readonly serverModules: ReadonlyMap<string, readonly ServerFunctionEntry[]>;
  readonly liveSources: readonly { readonly key: string }[];
  readonly hasLive: boolean;
  readonly pages: readonly PageRoute[];
  readonly diagnostics: readonly Diagnostic[];
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

const isAsyncFunction = (node: Node | undefined): boolean =>
  node !== undefined &&
  (node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression") &&
  node["async"] === true;

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
        if (declaration.type.startsWith("TS")) continue;
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
    } else {
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
    const target = local?.type === "Ref" ? functions.get(local["name"] as string) : local;
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

/** The exports of `live.ts` that are `defineLive(...)` calls (D56). */
function liveExports(program: Node): { key: string }[] {
  const keys: { key: string }[] = [];
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
      if (id.type === "Identifier" && calleeName === "defineLive")
        keys.push({ key: id["name"] as string });
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
  let liveSources: { key: string }[] = [];
  for (const file of files.sort()) {
    if (!SCRIPT.has(extname(file))) continue;
    const text = await readFile(join(sourceDir, file), "utf8");
    if (!text.includes("use server") && file !== "live.ts") continue;
    const lang = extname(file).replace(/^\.m?/, "") as "ts" | "tsx" | "js" | "jsx";
    const parsed = parseSync(file, text, {
      lang: lang === "ts" || lang === "tsx" || lang === "jsx" ? lang : "js",
    });
    if (parsed.errors.length > 0) continue; // The bundler reports syntax errors with full context.
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
  return { serverModules, liveSources, hasLive: files.includes("live.ts"), pages, diagnostics };
}
