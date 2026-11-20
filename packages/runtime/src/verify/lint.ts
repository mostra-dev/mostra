/**
 * The kit's lint (KT-08, D48, D179): the APIs that changed in a recent major of a kit library or a
 * tool artifacts use, each as one rule that finds the old form in the artifact's source and gives
 * the new one as a machine-applicable fix (`MOSTRA_LINT_API_CHANGED`); and the places a part of the
 * other base's idiom is used (`asChild` in a Base UI artifact, a `render` element in a Radix one),
 * which verify reports as `MOSTRA_KIT_WRONG_BASE` where the type check fails on them (TS2322).
 * Parsing only; nothing runs. Rules see what they can prove from the syntax and leave the rest:
 * a false report makes agents break working code (EVAL-01, D72).
 */
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname, join } from "node:path";
import { createDiagnostic, type Diagnostic, type DiagnosticFix } from "@mostra/protocol";
import type * as Oxc from "oxc-parser";

let oxc: typeof Oxc | undefined;
/**
 * Loads the native parser on first use: importing this module loads no native code, so the
 * platform gate answers before anything platform-specific loads (RT-07), as the ledger does.
 */
function parser(): typeof Oxc {
  oxc ??= createRequire(import.meta.url)("oxc-parser") as typeof Oxc;
  return oxc;
}

interface Node {
  readonly type: string;
  readonly start: number;
  readonly end: number;
  readonly [key: string]: unknown;
}

/** Where a part of the other base's idiom is used, and the fix that writes it in this base's. */
export interface WrongBaseSite {
  readonly file: string;
  /** The attribute's place (1-based), where the type check reports it. */
  readonly line: number;
  readonly column: number;
  /** The attribute: `asChild` (Radix's idiom) or `render` (Base UI's). */
  readonly attribute: "asChild" | "render";
  /** The element rewritten in this base's idiom, when it can be written mechanically. */
  readonly fix?: DiagnosticFix;
}

/** What the lint found in an artifact. */
export interface LintResult {
  readonly diagnostics: Diagnostic[];
  readonly wrongBase: WrongBaseSite[];
}

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

/** Zod 4's top-level string formats (`z.email()`), and those under `z.iso`. */
const ZOD_FORMATS = new Set([
  "email",
  "url",
  "uuid",
  "guid",
  "nanoid",
  "cuid",
  "cuid2",
  "ulid",
  "emoji",
  "base64",
  "base64url",
  "ipv4",
  "ipv6",
  "cidrv4",
  "cidrv6",
  "e164",
  "jwt",
]);
const ZOD_ISO = new Set(["datetime", "date", "time", "duration"]);

/** TanStack Table 8's API, which version 9 keeps in `@tanstack/react-table/legacy`. */
const TABLE_LEGACY: Readonly<Record<string, string>> = {
  useReactTable: "useLegacyTable",
  createColumnHelper: "legacyCreateColumnHelper",
  getCoreRowModel: "getCoreRowModel",
  getSortedRowModel: "getSortedRowModel",
  getFilteredRowModel: "getFilteredRowModel",
  getPaginationRowModel: "getPaginationRowModel",
  getExpandedRowModel: "getExpandedRowModel",
  getGroupedRowModel: "getGroupedRowModel",
  getFacetedRowModel: "getFacetedRowModel",
  getFacetedUniqueValues: "getFacetedUniqueValues",
  getFacetedMinMaxValues: "getFacetedMinMaxValues",
};

/** Tailwind CSS 3 classes Tailwind 4 renamed, with nothing else to decide. */
const TAILWIND_RENAMES: Readonly<Record<string, string>> = {
  "flex-shrink": "shrink",
  "flex-shrink-0": "shrink-0",
  "flex-grow": "grow",
  "flex-grow-0": "grow-0",
  "overflow-ellipsis": "text-ellipsis",
  "decoration-slice": "box-decoration-slice",
  "decoration-clone": "box-decoration-clone",
};
const GRADIENT = /^bg-gradient-to-(t|tr|r|br|b|bl|l|tl)$/;
/** A CSS variable in square brackets (`bg-[--brand]`), which Tailwind 4 writes in parentheses. */
const BRACKET_VARIABLE = /^([a-z][a-z0-9-]*)-\[(--[a-zA-Z0-9_-]+)\]$/;

/** The calls whose string arguments are class lists. */
const CLASS_CALLS = new Set(["cn", "clsx", "cva", "twMerge", "classNames", "cx"]);

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

/** One file's lint: its text, and a way to report a finding with a fix over a range of it. */
class FileLint {
  readonly file: string;
  readonly text: string;
  readonly out: LintResult;

  constructor(file: string, text: string, out: LintResult) {
    this.file = file;
    this.text = text;
    this.out = out;
  }

  fix(start: number, end: number, text: string): DiagnosticFix {
    const from = lineColumn(this.text, start);
    const to = lineColumn(this.text, end);
    return {
      kind: "replace",
      file: this.file,
      range: [from.line, from.column, to.line, to.column],
      text,
    };
  }

  report(rule: string, message: string, start: number, end: number, replacement: string): void {
    this.out.diagnostics.push(
      createDiagnostic("MOSTRA_LINT_API_CHANGED", {
        message: `${rule}: ${message}`,
        location: { file: this.file, ...lineColumn(this.text, start) },
        fix: this.fix(start, end, replacement),
      }),
    );
  }
}

/** The classes of a class list, each with its offset inside the list's text. */
function classTokens(text: string): { token: string; at: number }[] {
  const tokens: { token: string; at: number }[] = [];
  for (const match of text.matchAll(/\S+/g)) tokens.push({ token: match[0], at: match.index });
  return tokens;
}

/** A class's Tailwind 4 form, or `undefined` when it has none to change. */
export function tailwind4Class(token: string): string | undefined {
  // Variants (`hover:`, `md:`) stay; the utility after the last one outside brackets changes.
  let split = -1;
  let depth = 0;
  for (let index = 0; index < token.length; index++) {
    const char = token[index];
    if (char === "[" || char === "(") depth += 1;
    else if (char === "]" || char === ")") depth -= 1;
    else if (char === ":" && depth === 0) split = index;
  }
  const variants = token.slice(0, split + 1);
  const utility = token.slice(split + 1);
  const important = utility.startsWith("!") ? "!" : "";
  const bare = important ? utility.slice(1) : utility;
  const renamed = TAILWIND_RENAMES[bare];
  if (renamed !== undefined) return `${variants}${important}${renamed}`;
  const gradient = GRADIENT.exec(bare);
  if (gradient) return `${variants}${important}bg-linear-to-${gradient[1] as string}`;
  const bracket = BRACKET_VARIABLE.exec(bare);
  if (bracket) return `${variants}${important}${bracket[1] as string}-(${bracket[2] as string})`;
  return undefined;
}

/** Reports every class in a class list's text that Tailwind 4 writes another way. */
function lintClassList(lint: FileLint, text: string, offset: number): void {
  for (const { token, at } of classTokens(text)) {
    const next = tailwind4Class(token);
    if (next === undefined) continue;
    lint.report(
      "Tailwind CSS 4",
      `\`${token}\` is \`${next}\` in Tailwind CSS 4; the old class does nothing.`,
      offset + at,
      offset + at + token.length,
      next,
    );
  }
}

/** The kit parts' sources a file imports, by local name: kit parts are base-specific. */
function partNames(program: Node): Set<string> {
  const names = new Set<string>();
  for (const statement of program["body"] as Node[]) {
    if (statement.type !== "ImportDeclaration") continue;
    const source = (statement["source"] as Node)["value"] as string;
    const basePart =
      source.startsWith("@/components/ui/") ||
      source.startsWith("@base-ui/react") ||
      source === "radix-ui" ||
      source.startsWith("@radix-ui/");
    if (!basePart) continue;
    for (const specifier of statement["specifiers"] as Node[]) {
      names.add((specifier["local"] as Node)["name"] as string);
    }
  }
  return names;
}

/** The name an element is written with: `Dialog.Trigger`, `DialogTrigger`. */
function elementName(node: Node): string | undefined {
  if (node.type === "JSXIdentifier") return node["name"] as string;
  if (node.type === "JSXMemberExpression") {
    const object = elementName(node["object"] as Node);
    return object === undefined ? undefined : `${object}.${(node["property"] as Node)["name"]}`;
  }
  return undefined;
}

/** The one element a parent wraps, ignoring whitespace, or `undefined`. */
function onlyChild(element: Node): Node | undefined {
  const children = (element["children"] as Node[]).filter(
    (child) => !(child.type === "JSXText" && ((child["value"] as string) ?? "").trim() === ""),
  );
  return children.length === 1 && children[0]?.type === "JSXElement" ? children[0] : undefined;
}

/**
 * `<Trigger asChild …><Button …>Open</Button></Trigger>` in Base UI's idiom:
 * `<Trigger … render={<Button … />}>Open</Trigger>`.
 */
function asChildToRender(
  lint: FileLint,
  element: Node,
  attribute: Node,
): DiagnosticFix | undefined {
  const child = onlyChild(element);
  if (child === undefined) return undefined;
  const opening = element["openingElement"] as Node;
  const name = lint.text.slice((opening["name"] as Node).start, (opening["name"] as Node).end);
  const attributes = (opening["attributes"] as Node[])
    .filter((other) => other !== attribute)
    .map((other) => lint.text.slice(other.start, other.end));
  const childOpening = child["openingElement"] as Node;
  const childName = lint.text.slice(
    (childOpening["name"] as Node).start,
    (childOpening["name"] as Node).end,
  );
  const childAttributes = (childOpening["attributes"] as Node[]).map((other) =>
    lint.text.slice(other.start, other.end),
  );
  const rendered = `<${[childName, ...childAttributes].join(" ")} />`;
  const inner = child["closingElement"]
    ? lint.text.slice(childOpening.end, (child["closingElement"] as Node).start)
    : "";
  const head = [name, ...attributes, `render={${rendered}}`].join(" ");
  const text = inner.trim() === "" ? `<${head} />` : `<${head}>${inner}</${name}>`;
  return lint.fix(element.start, element.end, text);
}

/**
 * `<Trigger render={<Button … />} …>Open</Trigger>` in Radix's idiom:
 * `<Trigger asChild …><Button …>Open</Button></Trigger>`.
 */
function renderToAsChild(
  lint: FileLint,
  element: Node,
  attribute: Node,
): DiagnosticFix | undefined {
  const value = attribute["value"] as Node | null;
  const rendered =
    value?.type === "JSXExpressionContainer" ? (value["expression"] as Node) : undefined;
  if (rendered?.type !== "JSXElement") return undefined;
  const renderedOpening = rendered["openingElement"] as Node;
  if (rendered["closingElement"]) return undefined;
  const opening = element["openingElement"] as Node;
  const name = lint.text.slice((opening["name"] as Node).start, (opening["name"] as Node).end);
  const attributes = (opening["attributes"] as Node[])
    .filter((other) => other !== attribute)
    .map((other) => lint.text.slice(other.start, other.end));
  const renderedName = lint.text.slice(
    (renderedOpening["name"] as Node).start,
    (renderedOpening["name"] as Node).end,
  );
  const renderedAttributes = (renderedOpening["attributes"] as Node[]).map((other) =>
    lint.text.slice(other.start, other.end),
  );
  const inner = element["closingElement"]
    ? lint.text.slice(opening.end, (element["closingElement"] as Node).start)
    : "";
  const child =
    inner.trim() === ""
      ? `<${[renderedName, ...renderedAttributes].join(" ")} />`
      : `<${[renderedName, ...renderedAttributes].join(" ")}>${inner}</${renderedName}>`;
  return lint.fix(
    element.start,
    element.end,
    `<${[name, "asChild", ...attributes].join(" ")}>${child}</${name}>`,
  );
}

/** Lints one parsed script. */
function lintScript(lint: FileLint, program: Node, base: "base" | "radix"): void {
  const parts = partNames(program);
  // Local names of `mermaid` and of Zod's namespace.
  const mermaid = new Set<string>();
  const zod = new Set<string>();

  for (const statement of program["body"] as Node[]) {
    if (statement.type !== "ImportDeclaration") continue;
    const sourceNode = statement["source"] as Node;
    const source = sourceNode["value"] as string;
    const specifiers = statement["specifiers"] as Node[];
    const quote = lint.text[sourceNode.start] ?? '"';
    const literal = (value: string): string => `${quote}${value}${quote}`;
    if (source === "mermaid") {
      for (const specifier of specifiers) {
        if (
          specifier.type === "ImportDefaultSpecifier" ||
          specifier.type === "ImportNamespaceSpecifier"
        ) {
          mermaid.add((specifier["local"] as Node)["name"] as string);
        }
      }
    }
    if (source === "zod" || source === "zod/v4") {
      for (const specifier of specifiers) zod.add((specifier["local"] as Node)["name"] as string);
    }
    if (source === "framer-motion") {
      lint.report(
        "Motion",
        "Framer Motion is now Motion: import it from `motion/react`.",
        sourceNode.start,
        sourceNode.end,
        literal("motion/react"),
      );
    } else if (source === "react-router-dom") {
      lint.report(
        "React Router",
        "React Router is one package since version 7: import from `react-router`.",
        sourceNode.start,
        sourceNode.end,
        literal("react-router"),
      );
    } else if (source === "reactflow/dist/style.css") {
      lint.report(
        "React Flow",
        "React Flow 12 is `@xyflow/react`, its stylesheet `@xyflow/react/dist/style.css`.",
        sourceNode.start,
        sourceNode.end,
        literal("@xyflow/react/dist/style.css"),
      );
    } else if (source === "reactflow") {
      // React Flow 12 has no default export: `ReactFlow` is named.
      const named: string[] = [];
      for (const specifier of specifiers) {
        const local = (specifier["local"] as Node)["name"] as string;
        if (specifier.type === "ImportDefaultSpecifier") {
          named.push(local === "ReactFlow" ? "ReactFlow" : `ReactFlow as ${local}`);
        } else if (specifier.type === "ImportSpecifier") {
          named.push(lint.text.slice(specifier.start, specifier.end));
        }
      }
      const namespace = specifiers.find(
        (specifier) => specifier.type === "ImportNamespaceSpecifier",
      );
      const typeOnly = statement["importKind"] === "type" ? "type " : "";
      const replacement = namespace
        ? `import ${typeOnly}* as ${(namespace["local"] as Node)["name"]} from ${literal("@xyflow/react")};`
        : `import ${typeOnly}{ ${named.join(", ")} } from ${literal("@xyflow/react")};`;
      lint.report(
        "React Flow",
        "React Flow 12 is `@xyflow/react`, and `ReactFlow` is a named export.",
        statement.start,
        statement.end,
        replacement,
      );
    } else if (source === "@tanstack/react-table") {
      const legacy = specifiers.filter(
        (specifier) =>
          specifier.type === "ImportSpecifier" &&
          Object.hasOwn(TABLE_LEGACY, ((specifier["imported"] as Node)["name"] as string) ?? ""),
      );
      if (legacy.length === 0) continue;
      const kept = specifiers
        .filter((specifier) => !legacy.includes(specifier))
        .map((specifier) => lint.text.slice(specifier.start, specifier.end));
      const moved = legacy.map((specifier) => {
        const imported = (specifier["imported"] as Node)["name"] as string;
        const local = (specifier["local"] as Node)["name"] as string;
        const now = TABLE_LEGACY[imported] as string;
        return now === local ? now : `${now} as ${local}`;
      });
      const lines = [
        ...(kept.length > 0
          ? [`import { ${kept.join(", ")} } from ${literal("@tanstack/react-table")};`]
          : []),
        `import { ${moved.join(", ")} } from ${literal("@tanstack/react-table/legacy")};`,
      ];
      lint.report(
        "TanStack Table 9",
        "Version 8's `useReactTable` and row models are in `@tanstack/react-table/legacy` (`useLegacyTable`); new code uses `useTable` with `tableFeatures`.",
        statement.start,
        statement.end,
        lines.join("\n"),
      );
    }
  }

  const visit = (node: Node): void => {
    if (node.type === "CallExpression") {
      const callee = node["callee"] as Node;
      if (callee.type === "MemberExpression" && !callee["computed"]) {
        const property = (callee["property"] as Node)["name"] as string;
        const object = callee["object"] as Node;
        // Zod 4: `z.string().email()` is `z.email()`.
        if (
          object.type === "CallExpression" &&
          (object["arguments"] as Node[]).length === 0 &&
          (object["callee"] as Node).type === "MemberExpression"
        ) {
          const inner = object["callee"] as Node;
          const namespace = inner["object"] as Node;
          const name = namespace.type === "Identifier" ? (namespace["name"] as string) : undefined;
          if (
            name !== undefined &&
            zod.has(name) &&
            ((inner["property"] as Node)["name"] as string) === "string" &&
            (ZOD_FORMATS.has(property) || ZOD_ISO.has(property))
          ) {
            const now = ZOD_FORMATS.has(property)
              ? `${name}.${property}`
              : `${name}.iso.${property}`;
            lint.report(
              "Zod 4",
              `string formats are top-level in Zod 4: \`${now}()\`.`,
              object.start,
              (callee["property"] as Node).end,
              now,
            );
          }
        }
        // Mermaid 12: `init` is `run`, and `mermaidAPI.render` is `render`.
        if (object.type === "Identifier" && mermaid.has(object["name"] as string)) {
          if (property === "init" && (node["arguments"] as Node[]).length === 0) {
            lint.report(
              "Mermaid 12",
              "`mermaid.init()` is deprecated: `mermaid.run()` renders the page's diagrams.",
              (callee["property"] as Node).start,
              (callee["property"] as Node).end,
              "run",
            );
          }
        }
        if (
          property === "render" &&
          object.type === "MemberExpression" &&
          !object["computed"] &&
          ((object["property"] as Node)["name"] as string) === "mermaidAPI" &&
          (object["object"] as Node).type === "Identifier" &&
          mermaid.has((object["object"] as Node)["name"] as string)
        ) {
          lint.report(
            "Mermaid 12",
            "`mermaid.mermaidAPI.render` is deprecated: `mermaid.render` takes the same arguments.",
            object.start,
            (callee["property"] as Node).end,
            `${(object["object"] as Node)["name"]}.render`,
          );
        }
      }
      // Class lists in `cn(…)`, `cva(…)` and the like.
      if (callee.type === "Identifier" && CLASS_CALLS.has(callee["name"] as string)) {
        for (const argument of node["arguments"] as Node[]) classStrings(argument);
      }
    }
    if (node.type === "JSXAttribute") {
      const name = (node["name"] as Node)["name"];
      if (name === "className" || name === "class") {
        const value = node["value"] as Node | null;
        if (value?.type === "Literal") classStrings(value);
        else if (value?.type === "JSXExpressionContainer")
          classStrings(value["expression"] as Node);
      }
    }
    if (node.type === "JSXElement") wrongBase(node);
    each(node, (child) => visit(child));
  };

  /** Class lists in a string, a template's text, or the strings of a `cva` variant object. */
  const classStrings = (node: Node): void => {
    if (node.type === "Literal" && typeof node["value"] === "string") {
      lintClassList(lint, lint.text.slice(node.start + 1, node.end - 1), node.start + 1);
    } else if (node.type === "TemplateLiteral") {
      for (const quasi of node["quasis"] as Node[]) {
        lintClassList(lint, lint.text.slice(quasi.start, quasi.end), quasi.start);
      }
    } else if (node.type === "ObjectExpression") {
      for (const property of node["properties"] as Node[]) {
        if (property.type === "Property") classStrings(property["value"] as Node);
      }
    } else if (node.type === "ConditionalExpression") {
      classStrings(node["consequent"] as Node);
      classStrings(node["alternate"] as Node);
    } else if (node.type === "LogicalExpression") classStrings(node["right"] as Node);
  };

  const wrongBase = (element: Node): void => {
    const opening = element["openingElement"] as Node;
    const name = elementName(opening["name"] as Node);
    if (name === undefined || !parts.has(name.split(".")[0] as string)) return;
    for (const attribute of opening["attributes"] as Node[]) {
      if (attribute.type !== "JSXAttribute") continue;
      const attributeName = (attribute["name"] as Node)["name"];
      const wrong =
        (base === "base" && attributeName === "asChild") ||
        (base === "radix" &&
          attributeName === "render" &&
          ((attribute["value"] as Node | null)?.["expression"] as Node | undefined)?.type ===
            "JSXElement");
      if (!wrong) continue;
      const at = lineColumn(lint.text, attribute.start);
      const fix =
        base === "base"
          ? asChildToRender(lint, element, attribute)
          : renderToAsChild(lint, element, attribute);
      lint.out.wrongBase.push({
        file: lint.file,
        line: at.line,
        column: at.column,
        attribute: attributeName as "asChild" | "render",
        ...(fix ? { fix } : {}),
      });
    }
  };

  visit(program);
}

/** Tailwind 3's directives in a stylesheet: one `@import "tailwindcss";` in Tailwind 4. */
function lintStylesheet(lint: FileLint, layers: ReadonlySet<string>): void {
  const directives = [...lint.text.matchAll(/@tailwind\s+(base|components|utilities)\s*;/g)];
  directives.forEach((directive, index) => {
    lint.report(
      "Tailwind CSS 4",
      '`@tailwind` directives are one `@import "tailwindcss";` in Tailwind CSS 4; the old ones do nothing.',
      directive.index,
      directive.index + directive[0].length,
      index === 0 ? '@import "tailwindcss";' : "",
    );
  });
  if (directives.length > 0 || layers.has(lint.file)) return;
  // Tailwind's directives in a stylesheet Tailwind never processes: neither a layer of the theme
  // stack (which joins the build's one Tailwind run) nor a stylesheet that imports Tailwind.
  const comments = lint.text.replace(/\/\*[\s\S]*?\*\//g, (comment) => " ".repeat(comment.length));
  if (/@(?:import|reference)\s+["']tailwindcss["'/]/.test(comments)) return;
  const used = /@(theme|apply|utility|variant|custom-variant|source|plugin|config)\b/.exec(
    comments,
  );
  if (used === null) return;
  lint.out.diagnostics.push(
    createDiagnostic("MOSTRA_KIT_CSS_UNPROCESSED", {
      message: `${lint.file} uses Tailwind's @${used[1]}, but Tailwind never reads it: it isn't a layer of kit.theme and doesn't import Tailwind, so the page gets it unchanged.`,
      location: { file: lint.file, ...lineColumn(lint.text, used.index) },
    }),
  );
}

/**
 * shadcn's helper before the `cn` package (`clsx` and `tailwind-merge` in `lib/utils.ts`): the
 * whole file is `export { cn } from "cn"` now, which every kit part imports.
 */
function lintCnHelper(lint: FileLint): void {
  const canonical =
    /^\s*import\s*\{\s*(?:type\s+ClassValue\s*,\s*)?clsx(?:\s*,\s*type\s+ClassValue)?\s*\}\s*from\s*["']clsx["'];?\s*import\s*\{\s*twMerge\s*\}\s*from\s*["']tailwind-merge["'];?\s*export\s+function\s+cn\s*\(\s*\.\.\.\s*inputs\s*:\s*ClassValue\[\]\s*\)\s*\{\s*return\s+twMerge\s*\(\s*clsx\s*\(\s*inputs\s*\)\s*\)\s*;?\s*\}\s*$/;
  if (!canonical.test(lint.text)) return;
  lint.report(
    "cn",
    "shadcn's parts import `cn` from the `cn` package now; this helper is that package.",
    0,
    lint.text.length,
    'export { cn } from "cn";\n',
  );
}

/** Every file under `dir`, as `/`-separated paths inside it, without `node_modules` or dotfiles. */
async function sourceFiles(dir: string, prefix = ""): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(join(dir, prefix), { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) found.push(...(await sourceFiles(dir, path)));
    else if (entry.isFile()) found.push(path);
  }
  return found;
}

/** Lints the artifact's scripts and stylesheets in `sourceDir`, its snapshot. */
/**
 * Lints the artifact's scripts and stylesheets in `sourceDir`, its snapshot. `layers` are the
 * theme stack's own CSS files (paths inside it), which the build's Tailwind run reads.
 */
export async function lintArtifact(
  sourceDir: string,
  base: "base" | "radix",
  layers: readonly string[] = [],
): Promise<LintResult> {
  const out: LintResult = { diagnostics: [], wrongBase: [] };
  const themeLayers = new Set(layers);
  for (const file of (await sourceFiles(sourceDir)).sort()) {
    const ext = extname(file);
    const lang = SCRIPT_LANG[ext];
    if (lang === undefined && ext !== ".css") continue;
    const text = await readFile(join(sourceDir, file), "utf8");
    const lint = new FileLint(file, text, out);
    if (ext === ".css") {
      lintStylesheet(lint, themeLayers);
      continue;
    }
    lintCnHelper(lint);
    const parsed = parser().parseSync(file, text, { lang: lang ?? "tsx" });
    if (parsed.errors.length > 0) continue; // The build reports a file that doesn't parse.
    lintScript(lint, parsed.program as unknown as Node, base);
  }
  return out;
}
