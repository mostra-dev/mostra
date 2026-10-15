/**
 * The field scan (D109): every field ID the artifact's own code can use, read statically from its
 * scripts and MDX pages, for `registry.json`. Literal IDs of `useField` and `useChoice`, the form
 * adapter's `useForm({ id })` and `window.storage` become entries; anything the scan can't follow
 * (a computed ID, a hook passed around or re-exported) makes the coverage open, so a version never
 * orphans a field by a guess. Parsing only; nothing runs.
 */
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { compile } from "@mdx-js/mdx";
import { parseSync } from "oxc-parser";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import type { FieldCoverage, FieldEntry, FieldHook, FieldLocation } from "../coverage.ts";

interface Node {
  readonly type: string;
  readonly start: number;
  readonly end: number;
  readonly [key: string]: unknown;
}

/** The packages whose hooks name fields, and the hooks they export. */
const HOOKS: Readonly<Record<string, ReadonlySet<string>>> = {
  "@mostra/react": new Set(["useField", "useChoice"]),
  "@mostra/react/form": new Set(["useForm"]),
};

/** The global objects `storage` hangs off (D53). */
const GLOBALS = new Set(["window", "globalThis", "self"]);

/** `window.storage`'s methods. */
const STORAGE_METHODS = new Set(["get", "set", "delete", "list"]);

const SCRIPT_LANG: Readonly<Record<string, "ts" | "tsx" | "js" | "jsx">> = {
  ".ts": "ts",
  ".mts": "ts",
  ".cts": "ts",
  ".tsx": "tsx",
  ".js": "js",
  ".mjs": "js",
  ".cjs": "js",
  ".jsx": "jsx",
};

function lineColumn(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  return { line: before.split("\n").length, column: offset - before.lastIndexOf("\n") };
}

function each(node: Node, visit: (child: Node, key: string) => void): void {
  for (const [key, value] of Object.entries(node)) {
    if (Array.isArray(value)) {
      for (const item of value)
        if (item && typeof item === "object" && "type" in item) visit(item as Node, key);
    } else if (value && typeof value === "object" && "type" in value) visit(value as Node, key);
  }
}

/** TypeScript wrappers that compile away. */
const ERASED = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
  "ParenthesizedExpression",
]);

function unwrap(node: Node | undefined): Node | undefined {
  let current = node;
  while (current !== undefined && ERASED.has(current.type))
    current = current["expression"] as Node | undefined;
  return current;
}

/** A string literal or template's parts: one part for a literal, holes between parts otherwise. */
function idParts(node: Node | undefined): string[] | undefined {
  const target = unwrap(node);
  if (target?.type === "Literal" && typeof target["value"] === "string") return [target["value"]];
  if (target?.type === "TemplateLiteral") {
    const parts = (target["quasis"] as Node[]).map(
      (quasi) => (quasi["value"] as { cooked: string | null }).cooked,
    );
    if (parts.some((part) => part === null)) return undefined;
    return parts as string[];
  }
  return undefined;
}

/** A literal object's literal string or boolean properties. */
function literalOptions(node: Node | undefined): Record<string, string | boolean> | undefined {
  const target = unwrap(node);
  if (target?.type !== "ObjectExpression") return undefined;
  const out: Record<string, string | boolean> = {};
  for (const property of target["properties"] as Node[]) {
    if (property.type !== "Property" || property["computed"]) continue;
    const key = property["key"] as Node;
    const name = key.type === "Identifier" ? key["name"] : key["value"];
    const value = unwrap(property["value"] as Node);
    if (
      typeof name === "string" &&
      value?.type === "Literal" &&
      (typeof value["value"] === "string" || typeof value["value"] === "boolean")
    ) {
      out[name] = value["value"];
    }
  }
  return out;
}

/** The scan of one artifact. */
class FieldScan {
  readonly entries: FieldEntry[] = [];
  readonly openReasons: { reason: string; location?: FieldLocation }[] = [];

  open(reason: string, location?: FieldLocation): void {
    this.openReasons.push({ reason, ...(location ? { location } : {}) });
  }

  /** Scans one parsed module; `text` is what offsets refer to. */
  module(file: string, text: string, program: Node): void {
    const at = (node: Node): FieldLocation => ({ file, ...lineColumn(text, node.start) });
    // Local names of the hooks, and namespaces of their packages.
    const hooks = new Map<string, FieldHook>();
    const namespaces = new Map<string, ReadonlySet<string>>();
    for (const statement of program["body"] as Node[]) {
      const source =
        statement.type === "ImportDeclaration" ||
        statement.type === "ExportNamedDeclaration" ||
        statement.type === "ExportAllDeclaration"
          ? ((statement["source"] as Node | null)?.["value"] as string | undefined)
          : undefined;
      const exported = source === undefined ? undefined : HOOKS[source];
      if (!exported) continue;
      if (statement.type !== "ImportDeclaration") {
        // Re-exporting a hook hands it to code the scan can't follow.
        this.open(`${file} re-exports from ${source}`, at(statement));
        continue;
      }
      if (statement["importKind"] === "type") continue;
      for (const specifier of statement["specifiers"] as Node[]) {
        const local = (specifier["local"] as Node)["name"] as string;
        if (specifier.type === "ImportNamespaceSpecifier") namespaces.set(local, exported);
        else if (specifier.type === "ImportSpecifier" && specifier["importKind"] !== "type") {
          const imported = specifier["imported"] as Node;
          const name = (imported["name"] ?? imported["value"]) as string;
          if (exported.has(name)) hooks.set(local, name as FieldHook);
        }
      }
    }

    const hookOf = (callee: Node | undefined): FieldHook | undefined => {
      const target = unwrap(callee);
      if (target?.type === "Identifier") return hooks.get(target["name"] as string);
      if (target?.type === "MemberExpression" && !target["computed"]) {
        const object = target["object"] as Node;
        const property = (target["property"] as Node)["name"] as string;
        const names =
          object.type === "Identifier" ? namespaces.get(object["name"] as string) : undefined;
        if (names?.has(property)) return property as FieldHook;
      }
      return undefined;
    };

    const callees = new Set<Node>();
    const visit = (node: Node): void => {
      if (node.type === "CallExpression") {
        const callee = node["callee"] as Node;
        const hook = hookOf(callee);
        if (hook) {
          callees.add(unwrap(callee) as Node);
          this.call(hook, node["arguments"] as Node[], at(node));
        }
        // `window.storage.get(…)` and the bare `storage.get(…)` of Claude's artifacts (D53).
        const target = unwrap(callee);
        if (target?.type === "MemberExpression" && !target["computed"]) {
          const object = unwrap(target["object"] as Node);
          const method = (target["property"] as Node)["name"] as string;
          const isStorage =
            (object?.type === "MemberExpression" &&
              !object["computed"] &&
              (object["object"] as Node).type === "Identifier" &&
              GLOBALS.has((object["object"] as Node)["name"] as string) &&
              (object["property"] as Node)["name"] === "storage") ||
            (object?.type === "Identifier" && object["name"] === "storage");
          if (isStorage && STORAGE_METHODS.has(method)) this.storage(at(node));
        }
      }
      // `const s = window.storage` hands storage on: every key is possible.
      if (
        node.type === "MemberExpression" &&
        !node["computed"] &&
        (node["object"] as Node).type === "Identifier" &&
        GLOBALS.has((node["object"] as Node)["name"] as string) &&
        (node["property"] as Node)["name"] === "storage"
      ) {
        this.storage(at(node));
      }
      each(node, (child) => visit(child));
    };
    visit(program);

    // A hook referenced anywhere but as a callee is passed around: its IDs are unknowable.
    const references = (node: Node, parentKey: string, parent: Node | undefined): void => {
      if (
        node.type === "Identifier" &&
        parentKey !== "property" &&
        parentKey !== "key" &&
        parent?.type !== "ImportSpecifier" &&
        parent?.type !== "ImportNamespaceSpecifier"
      ) {
        const name = node["name"] as string;
        if (hooks.has(name) && !callees.has(node)) {
          this.open(`${file} uses ${name} other than by calling it`, at(node));
        }
        const exported = namespaces.get(name);
        if (exported) {
          const member =
            parent?.type === "MemberExpression" && parentKey === "object" && !parent["computed"]
              ? ((parent["property"] as Node)["name"] as string)
              : undefined;
          const passedOn =
            member === undefined || (exported.has(member) && !callees.has(parent as Node));
          if (passedOn) this.open(`${file} uses ${name} other than by calling its hooks`, at(node));
        }
      }
      each(node, (child, key) => references(child, key, node));
    };
    references(program, "", undefined);
  }

  storage(location: FieldLocation): void {
    if (this.entries.some((entry) => entry.hook === "storage")) return;
    // Personal keys are the viewer's fields under `storage.`; shared ones are artifact state.
    this.entries.push(
      { template: ["storage.", ""], hook: "storage", scope: "viewer", location },
      { template: ["storage.", ""], hook: "storage", scope: "artifact", location },
    );
  }

  call(hook: FieldHook, args: Node[], location: FieldLocation): void {
    const first = args[0];
    if (hook === "useForm") {
      const options = unwrap(first);
      const idProperty =
        options?.type === "ObjectExpression"
          ? (options["properties"] as Node[]).find(
              (property) =>
                property.type === "Property" &&
                !property["computed"] &&
                ((property["key"] as Node)["name"] ?? (property["key"] as Node)["value"]) === "id",
            )
          : undefined;
      const parts = idParts(idProperty?.["value"] as Node | undefined);
      if (!parts) {
        this.open("a useForm call without a literal id", location);
        return;
      }
      // Every registered field is `<id>.<name>` (the form adapter).
      const template = [...parts.slice(0, -1), `${parts.at(-1) as string}.`, ""];
      this.entries.push({ template, hook, location });
      return;
    }
    const parts = idParts(first);
    if (!parts) {
      this.open(`a ${hook} call whose ID isn't a string literal or template`, location);
      return;
    }
    // A choice is the field `review.<set>.choice` (D65).
    const wrap = (inner: string[]): string[] => {
      if (hook !== "useChoice") return inner;
      const out = [...inner];
      out[0] = `review.${out[0] as string}`;
      out[out.length - 1] = `${out.at(-1) as string}.choice`;
      return out;
    };
    const wrapped = wrap(parts);
    const singleLiteral = parts.length === 1;
    const options = hook === "useField" ? literalOptions(args[2]) : undefined;
    // Only `"artifact"` takes a field out of drafts; a scope the scan can't read may be the
    // viewer's, which keeps the field covered.
    const scopeOption = options?.["scope"];
    const scope = scopeOption === "artifact" || scopeOption === "viewer" ? scopeOption : undefined;
    this.entries.push({
      ...(singleLiteral ? { id: wrapped.join("") } : { template: wrapped }),
      hook,
      ...(scope !== undefined ? { scope } : {}),
      ...(typeof options?.["label"] === "string" ? { label: options["label"] } : {}),
      ...(typeof options?.["required"] === "boolean" ? { required: options["required"] } : {}),
      ...(typeof options?.["sensitive"] === "boolean" ? { sensitive: options["sensitive"] } : {}),
      location,
    });
  }

  result(): FieldCoverage {
    // A version that declares no field through the hooks may still take answers through the
    // browser protocol itself; the scan can't see those, so nothing is orphaned by a guess.
    if (this.entries.length === 0 && this.openReasons.length === 0) {
      this.open("the artifact declares no fields through @mostra/react");
    }
    return {
      open: this.openReasons.length > 0,
      openReasons: this.openReasons,
      entries: this.entries,
    };
  }
}

/** Mentions that make a file worth parsing for fields. */
const MENTIONS = /@mostra\/react|storage/;

/** A file that speaks the browser protocol itself writes fields the scan can't follow. */
const RAW_PROTOCOL = /_mostra\/v\//;

/** Scans the artifact's scripts and MDX pages (`files` are paths inside `sourceDir`). */
export async function scanFields(
  sourceDir: string,
  files: readonly string[],
): Promise<FieldCoverage> {
  const scan = new FieldScan();
  for (const file of [...files].sort()) {
    const ext = extname(file);
    const lang = SCRIPT_LANG[ext];
    if (lang === undefined && ext !== ".mdx") continue;
    const source = await readFile(join(sourceDir, file), "utf8");
    if (RAW_PROTOCOL.test(source)) scan.open(`${file} calls the browser protocol directly`);
    if (!MENTIONS.test(source)) continue;
    let text = source;
    let parseLang: "ts" | "tsx" | "js" | "jsx" = lang ?? "jsx";
    if (ext === ".mdx") {
      try {
        const compiled = await compile(
          { value: source, path: file },
          { jsxImportSource: "react", remarkPlugins: [remarkFrontmatter, remarkGfm] },
        );
        text = String(compiled.value);
        parseLang = "js";
      } catch {
        // The bundler reports the MDX error; nothing here can be known about its fields.
        scan.open(`${file} doesn't compile`);
        continue;
      }
    }
    const parsed = parseSync(file, text, { lang: parseLang });
    if (parsed.errors.length > 0) {
      scan.open(`${file} doesn't parse`);
      continue;
    }
    // MDX offsets refer to the compiled text, so its locations name only the file.
    scan.module(file, text, parsed.program as unknown as Node);
  }
  return scan.result();
}
