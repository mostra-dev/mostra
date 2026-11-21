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

/**
 * The kit's questionnaire (WP-18), by the module an artifact imports it from: the package, or its
 * copy in the artifact. Its answers are fields its parts' `id`s name (`<questionnaire>.<question>`,
 * with `.comment` and `.other` beside each), so the scan reads them from the JSX. Imported any other
 * way, the build opens the coverage (`fieldHookUsePlugin`).
 */
export const KIT_FIELD_MODULES: ReadonlySet<string> = new Set([
  "@mostra/kit/questionnaire",
  "@/components/mostra/questionnaire",
]);
const QUESTIONNAIRE_MODULES = KIT_FIELD_MODULES;
const QUESTIONNAIRE_PARTS = new Set(["Questionnaire", "Question"]);

/** The fields a question's answer may be: the answer, its comment and an answer of its own. */
const QUESTION_SUFFIXES = ["", ".comment", ".other"];

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

/**
 * A literal object's literal string or boolean properties, as they stand after every property
 * in order: a spread or a computed key may override anything before it, so what came before is
 * forgotten (GPT review finding 12); a property the scan can't read is left out.
 */
function literalOptions(node: Node | undefined): Record<string, string | boolean> | undefined {
  const target = unwrap(node);
  if (target?.type !== "ObjectExpression") return undefined;
  let out: Record<string, string | boolean> = {};
  for (const property of target["properties"] as Node[]) {
    if (property.type !== "Property" || property["computed"]) {
      out = {};
      continue;
    }
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
    // Local names of the questionnaire's parts, and namespaces of its module.
    const parts = new Map<string, string>();
    const partNamespaces = new Set<string>();
    for (const statement of program["body"] as Node[]) {
      const source =
        statement.type === "ImportDeclaration" ||
        statement.type === "ExportNamedDeclaration" ||
        statement.type === "ExportAllDeclaration"
          ? ((statement["source"] as Node | null)?.["value"] as string | undefined)
          : undefined;
      if (source !== undefined && QUESTIONNAIRE_MODULES.has(source)) {
        if (statement.type !== "ImportDeclaration") {
          this.open(`${file} re-exports from ${source}`, at(statement));
          continue;
        }
        for (const specifier of statement["specifiers"] as Node[]) {
          const local = (specifier["local"] as Node)["name"] as string;
          if (specifier.type === "ImportNamespaceSpecifier") partNamespaces.add(local);
          else if (specifier.type === "ImportSpecifier") {
            const imported = specifier["imported"] as Node;
            const name = (imported["name"] ?? imported["value"]) as string;
            if (QUESTIONNAIRE_PARTS.has(name)) parts.set(local, name);
          }
        }
        continue;
      }
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
    // The questionnaire part a JSX element is, by its name.
    const partOf = (element: Node): string | undefined => {
      const name = (element["openingElement"] as Node)["name"] as Node;
      if (name.type === "JSXIdentifier") return parts.get(name["name"] as string);
      if (name.type === "JSXMemberExpression") {
        const object = name["object"] as Node;
        const property = (name["property"] as Node)["name"] as string;
        if (
          object.type === "JSXIdentifier" &&
          partNamespaces.has(object["name"] as string) &&
          QUESTIONNAIRE_PARTS.has(property)
        )
          return property;
      }
      return undefined;
    };
    const visit = (node: Node, questionnaire: string[] | null | undefined): void => {
      if (node.type === "JSXElement") {
        const part = partOf(node);
        if (part === "Questionnaire") {
          const id = this.jsxId(node, at(node));
          if (id === undefined)
            this.open("a <Questionnaire> whose id isn't a string literal", at(node));
          for (const child of (node["children"] as Node[]) ?? []) visit(child, id ?? null);
          return;
        }
        if (part === "Question") {
          if (questionnaire === undefined) {
            // Its questionnaire's ID is somewhere the scan doesn't follow (another component).
            this.open("a <Question> outside a <Questionnaire> in the same file", at(node));
          } else if (questionnaire !== null) this.question(node, questionnaire, at(node));
        }
      }
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
      each(node, (child) => visit(child, questionnaire));
    };
    visit(program, undefined);

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
        if (parts.has(name) || partNamespaces.has(name)) {
          // A part passed around renders where the scan can't see its questionnaire's ID.
          this.open(`${file} uses ${name} other than as an element`, at(node));
        }
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

  /**
   * The parts of a JSX element's `id` (a string, or a literal or template in braces), unless a
   * spread after it may replace it.
   */
  jsxId(element: Node, _location: FieldLocation): string[] | undefined {
    let parts: string[] | undefined;
    for (const attribute of (element["openingElement"] as Node)["attributes"] as Node[]) {
      if (attribute.type === "JSXSpreadAttribute") {
        parts = undefined;
        continue;
      }
      const name = attribute["name"] as Node;
      if (name.type !== "JSXIdentifier" || name["name"] !== "id") continue;
      const value = attribute["value"] as Node | null;
      if (value?.type === "Literal" && typeof value["value"] === "string") parts = [value["value"]];
      else if (value?.type === "JSXExpressionContainer")
        parts = idParts(value["expression"] as Node);
      else parts = undefined;
    }
    return parts;
  }

  /** A JSX attribute's literal string or `true`, when the element names it plainly. */
  jsxLiteral(element: Node, attributeName: string): string | boolean | undefined {
    let found: string | boolean | undefined;
    for (const attribute of (element["openingElement"] as Node)["attributes"] as Node[]) {
      if (attribute.type === "JSXSpreadAttribute") {
        found = undefined;
        continue;
      }
      const name = attribute["name"] as Node;
      if (name.type !== "JSXIdentifier" || name["name"] !== attributeName) continue;
      const value = attribute["value"] as Node | null;
      if (value === null) found = true;
      else if (value.type === "Literal" && typeof value["value"] === "string")
        found = value["value"];
      else if (value.type === "JSXExpressionContainer") {
        const expression = unwrap(value["expression"] as Node);
        found =
          expression?.type === "Literal" &&
          (typeof expression["value"] === "string" || typeof expression["value"] === "boolean")
            ? expression["value"]
            : undefined;
      } else found = undefined;
    }
    return found;
  }

  /** A `<Question>` inside a questionnaire whose ID is `questionnaire`: its answer's fields. */
  question(element: Node, questionnaire: string[], location: FieldLocation): void {
    const id = this.jsxId(element, location);
    if (id === undefined) {
      // A computed question ID keeps the questionnaire's prefix: `<questionnaire>.…`.
      this.entries.push({
        template: [...questionnaire.slice(0, -1), `${questionnaire.at(-1) as string}.`, ""],
        hook: "questionnaire",
        location,
      });
      return;
    }
    const joined = [
      ...questionnaire.slice(0, -1),
      `${questionnaire.at(-1) as string}.${id[0] as string}`,
      ...id.slice(1),
    ];
    const title = this.jsxLiteral(element, "label") ?? this.jsxLiteral(element, "title");
    const required = this.jsxLiteral(element, "required");
    for (const suffix of QUESTION_SUFFIXES) {
      const parts = [...joined.slice(0, -1), `${joined.at(-1) as string}${suffix}`];
      this.entries.push({
        ...(parts.length === 1 ? { id: parts[0] as string } : { template: parts }),
        hook: "questionnaire",
        ...(suffix === "" && typeof title === "string" ? { label: title } : {}),
        ...(suffix === "" && required === true ? { required: true } : {}),
        location,
      });
    }
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
      // The id that stands: the last one, unless a spread or computed key after it may replace it.
      let idProperty: Node | undefined;
      if (options?.type === "ObjectExpression") {
        for (const property of options["properties"] as Node[]) {
          if (property.type !== "Property" || property["computed"]) idProperty = undefined;
          else if (
            ((property["key"] as Node)["name"] ?? (property["key"] as Node)["value"]) === "id"
          ) {
            idProperty = property;
          }
        }
      }
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
const MENTIONS =
  /@mostra\/react|@mostra\/kit\/questionnaire|components\/mostra\/questionnaire|storage/;

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
