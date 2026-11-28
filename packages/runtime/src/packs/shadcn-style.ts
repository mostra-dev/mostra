/**
 * What shadcn's CLI does to an item of one of its styles as it installs it (#219, WP-19), for
 * `mostra add`, which places items byte for byte as shadcn 4.23.0 does (EX-03, D172 item 10).
 *
 * Items of shadcn's `base-nova` and `radix-nova` styles name their icons with an `IconPlaceholder`
 * element, one prop per icon library, and mark classes for the CLI (`cn-font-heading`,
 * `cn-menu-target`, `cn-menu-translucent`, `cn-rtl-flip`, …). shadcn 4.23.0 rewrites them with
 * `@shadcn/registry` 0.2.1's transformers, in this order: the icons (into the icon library
 * `components.json` names, lucide by default), the menus (its `menuColor`), right to left (its
 * `rtl`), the heading face (where the stylesheet defines `--font-heading`, as every Mostra theme
 * does), and a cleanup that drops every other marker. This is the same rewriting on oxc's tree,
 * without shadcn's Babel stack (which would bring a non-OSI data file into the core), proved equal
 * to shadcn's own code over every item of both styles and every option (`shadcn-style.test.ts`).
 */
import { createRequire } from "node:module";
import type * as Oxc from "oxc-parser";

/** How the artifact's `components.json` says to install a styled item. */
export interface StyleOptions {
  /** The icon library placeholders become: `lucide` by default. */
  readonly iconLibrary: string;
  /** `components.json`'s `menuColor`: `default` unless it says otherwise. */
  readonly menuColor: string;
  /** Whether the project writes right to left. */
  readonly rtl: boolean;
  /** Whether the stylesheet defines `--font-heading`, so `cn-font-heading` is `font-heading`. */
  readonly fontHeading: boolean;
}

/** shadcn's icon libraries (`@shadcn/registry`'s `icons/libraries`). */
const LIBRARIES: Readonly<
  Record<string, { readonly imports: readonly string[]; readonly usage: string }>
> = {
  lucide: { imports: ["import { ICON } from 'lucide-react'"], usage: "<ICON />" },
  tabler: { imports: ["import { ICON } from '@tabler/icons-react'"], usage: "<ICON />" },
  hugeicons: {
    imports: [
      "import { HugeiconsIcon } from '@hugeicons/react'",
      "import { ICON } from '@hugeicons/core-free-icons';",
    ],
    usage: "<HugeiconsIcon icon={ICON} strokeWidth={2} />",
  },
  phosphor: {
    imports: ["import { ICON } from '@phosphor-icons/react'"],
    usage: "<ICON strokeWidth={2} />",
  },
  remixicon: { imports: ["import { ICON } from '@remixicon/react'"], usage: "<ICON />" },
};

/** The marker of a translucent menu's classes, and the classes it becomes (shadcn's `transformMenu`). */
const TRANSLUCENT =
  "animate-none! relative bg-popover/70 before:pointer-events-none before:absolute before:inset-0 before:-z-1 before:rounded-[inherit] before:backdrop-blur-2xl before:backdrop-saturate-150 **:data-[slot$=-item]:focus:bg-foreground/10 **:data-[slot$=-item]:data-highlighted:bg-foreground/10 **:data-[slot$=-separator]:bg-foreground/5 **:data-[slot$=-trigger]:focus:bg-foreground/10 **:data-[slot$=-trigger]:aria-expanded:bg-foreground/10! **:data-[variant=destructive]:focus:bg-foreground/10! **:data-[variant=destructive]:text-accent-foreground! **:data-[variant=destructive]:**:text-accent-foreground!";

// ── The tree ──────────────────────────────────────────────────────────────────────────────

interface Node {
  readonly type: string;
  readonly start: number;
  readonly end: number;
  readonly [key: string]: unknown;
}

let oxc: typeof Oxc | undefined;
function parse(code: string): Node | undefined {
  oxc ??= createRequire(import.meta.url)("oxc-parser") as typeof Oxc;
  const parsed = oxc.parseSync("item.tsx", code, { lang: "tsx", sourceType: "module" });
  if (parsed.errors.length > 0) return undefined;
  return parsed.program as unknown as Node;
}

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && typeof (value as Node).type === "string";
}

/** Every node under `root` (itself included) that `test` takes, in source order. */
function all(root: Node, test: (node: Node) => boolean): Node[] {
  const found: Node[] = [];
  const visit = (node: Node): void => {
    if (test(node)) found.push(node);
    const children: Node[] = [];
    for (const [key, value] of Object.entries(node)) {
      if (key === "parent") continue;
      if (Array.isArray(value)) for (const item of value) if (isNode(item)) children.push(item);
      if (isNode(value)) children.push(value);
    }
    children.sort((a, b) => a.start - b.start);
    for (const child of children) visit(child);
  };
  visit(root);
  return found;
}

const isString = (node: Node | null | undefined): node is Node & { readonly value: string } =>
  node?.type === "Literal" && typeof node["value"] === "string";
const isPlainTemplate = (node: Node): boolean =>
  node.type === "TemplateLiteral" && (node["expressions"] as Node[]).length === 0;
const textOf = (code: string, node: Node): string => code.slice(node.start, node.end);
const nameOf = (code: string, node: Node): string => textOf(code, node);

/** A property's key as written (`variants`, `"variants"`). */
function keyOf(code: string, property: Node): string {
  const key = property["key"] as Node;
  return isString(key) ? (key["value"] as string) : textOf(code, key);
}

interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}
function apply(code: string, edits: readonly Edit[]): string {
  let out = code;
  for (const edit of [...edits].sort((a, b) => b.start - a.start || b.end - a.end)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }
  return out;
}

const SPACE = /[ \f\n\r\t\v\u00a0\u2028\u2029]/;

/** Every JSX attribute of every opening element, by position. */
function attributes(program: Node): { attribute: Node; element: Node }[] {
  return all(program, (node) => node.type === "JSXOpeningElement")
    .flatMap((element) =>
      (element["attributes"] as Node[])
        .filter((attribute) => attribute.type === "JSXAttribute")
        .map((attribute) => ({ attribute, element })),
    )
    .sort((a, b) => a.attribute.start - b.attribute.start);
}

/** The edit that removes an attribute and the space before it. */
function removeAttribute(code: string, attribute: Node): Edit {
  let start = attribute.start;
  while (start > 0 && SPACE.test(code[start - 1] ?? "")) start--;
  return { start, end: attribute.end, text: "" };
}

/** The values of string literals as shadcn's editor reads and writes them. */
class Strings {
  readonly #code: string;
  readonly #strings: Node[];
  readonly #templates: Node[];
  readonly #jsx: Set<Node>;
  readonly #edits = new Map<Node, Edit>();

  constructor(code: string, program: Node) {
    this.#code = code;
    this.#strings = all(program, (node) => isString(node));
    this.#templates = all(program, isPlainTemplate);
    this.#jsx = new Set(
      all(program, (node) => node.type === "JSXAttribute").flatMap((attribute) => {
        const value = attribute["value"] as Node | null;
        return isString(value) ? [value] : [];
      }),
    );
  }

  /** The literals strictly inside `node`. */
  strings(node: Node): Node[] {
    return this.#strings.filter((s) => s !== node && node.start <= s.start && s.end <= node.end);
  }

  templates(node: Node): Node[] {
    return this.#templates.filter((s) => s !== node && node.start <= s.start && s.end <= node.end);
  }

  get(node: Node): string {
    const edit = this.#edits.get(node);
    if (this.#jsx.has(node)) return edit?.text ?? this.#code.slice(node.start + 1, node.end - 1);
    if (edit !== undefined) return literalValue(edit.text, this.#code[node.start] ?? '"');
    if (node.type === "TemplateLiteral") {
      return ((node["quasis"] as Node[])[0]?.["value"] as { cooked?: string })?.cooked ?? "";
    }
    return node["value"] as string;
  }

  set(node: Node, value: string): void {
    const quote = this.#code[node.start] === "'" ? "'" : '"';
    const text =
      node.type === "TemplateLiteral"
        ? value
        : value
            .split(quote)
            .join(`\\${quote}`)
            .replace(/(\r?\n)/g, "\\$1");
    this.#edits.set(node, { start: node.start + 1, end: node.end - 1, text });
  }

  edits(): Edit[] {
    return [...this.#edits.values()];
  }

  apply(): string {
    return apply(this.#code, this.edits());
  }
}

/** A string literal's text, between its quotes, read back as its value (shadcn reads it so). */
function literalValue(text: string, quote: string): string {
  const program = parse(`(${quote}${text}${quote});`);
  const statement = (program?.["body"] as Node[] | undefined)?.[0];
  const expression = statement?.["expression"] as Node | undefined;
  return isString(expression) ? expression.value : text;
}

/**
 * Rewrites the classes `rewrite` changes in an item: `className` and `classNames` attributes (a
 * plain string, or every string inside an expression), then the arguments of `cva(…)` and
 * `mergeProps(…)`. An attribute left with no class is removed. (shadcn's `transformFont` and
 * `transformCleanup`.)
 */
function rewriteClasses(
  code: string,
  touches: (value: string) => boolean,
  rewrite: (value: string) => string,
): string {
  let program = parse(code);
  if (!program) return code;
  const strings = new Strings(code, program);
  const one = (node: Node): void => {
    const value = strings.get(node);
    if (!touches(value)) return;
    const next = rewrite(value);
    if (next !== value) strings.set(node, next);
  };
  const inside = (node: Node): void => {
    for (const s of strings.strings(node)) one(s);
    for (const t of strings.templates(node)) one(t);
  };
  const removed: Node[] = [];
  for (const { attribute } of attributes(program)) {
    const name = nameOf(code, attribute["name"] as Node);
    if (name !== "className" && name !== "classNames") continue;
    const value = attribute["value"] as Node | null;
    if (isString(value)) {
      const text = strings.get(value);
      if (touches(text)) {
        const next = rewrite(text);
        if (next === "") removed.push(attribute);
        else if (next !== text) strings.set(value, next);
      }
    }
    if (value?.type === "JSXExpressionContainer") inside(value);
  }
  let out = apply(code, [
    ...strings
      .edits()
      .filter((edit) => !removed.some((a) => a.start <= edit.start && edit.end <= a.end)),
    ...removed.map((attribute) => removeAttribute(code, attribute)),
  ]);
  program = parse(out);
  if (!program) return out;
  const again = new Strings(out, program);
  const oneAgain = (node: Node): void => {
    const value = again.get(node);
    if (!touches(value)) return;
    const next = rewrite(value);
    if (next !== value) again.set(node, next);
  };
  const insideAgain = (node: Node): void => {
    for (const s of again.strings(node)) oneAgain(s);
    for (const t of again.templates(node)) oneAgain(t);
  };
  const calls = all(program, (node) => node.type === "CallExpression");
  for (const call of calls) {
    if (nameOf(out, call["callee"] as Node) !== "cva") continue;
    for (const argument of call["arguments"] as Node[]) {
      if (isString(argument) || isPlainTemplate(argument)) oneAgain(argument);
      else insideAgain(argument);
    }
  }
  for (const call of calls) {
    if (nameOf(out, call["callee"] as Node) === "mergeProps") insideAgain(call);
  }
  out = again.apply();
  return out;
}

// ── Icons ─────────────────────────────────────────────────────────────────────────────────

/** The top-level import declarations. */
const importsOf = (program: Node): Node[] =>
  (program["body"] as Node[]).filter((node) => node.type === "ImportDeclaration");

function transformIcons(code: string, library: string): string {
  const icons = LIBRARIES[library];
  if (icons === undefined) return code;
  const program = parse(code);
  if (!program) return code;
  const names: string[] = [];
  const edits: Edit[] = [];
  const elements = all(
    program,
    (node) =>
      node.type === "JSXElement" &&
      ((node["openingElement"] as Node)["selfClosing"] as boolean) &&
      nameOf(code, (node["openingElement"] as Node)["name"] as Node) === "IconPlaceholder",
  );
  for (const element of elements) {
    const replaced = iconElement(code, element, library, icons.usage);
    if (replaced === undefined) continue;
    if (!names.includes(replaced.icon)) names.push(replaced.icon);
    edits.push({ start: element.start, end: element.end, text: replaced.text });
  }
  return withIconImports(apply(code, edits), names, icons.imports);
}

/** One placeholder as its library's icon, or `undefined` where it names none for the library. */
function iconElement(
  code: string,
  element: Node,
  library: string,
  usage: string,
): { icon: string; text: string } | undefined {
  const opening = element["openingElement"] as Node;
  const own = (opening["attributes"] as Node[]).filter((a) => a.type === "JSXAttribute");
  const named = own.find((a) => nameOf(code, a["name"] as Node) === library);
  if (named === undefined) return undefined;
  const value = named["value"] as Node | null;
  const icon = value ? textOf(code, value).replace(/^["']|["']$/g, "") : "";
  if (!icon) return undefined;
  // The element's text without every library's prop.
  const drop = own.filter((a) => nameOf(code, a["name"] as Node) in LIBRARIES);
  const local = (node: Node): Node => ({
    ...node,
    start: node.start - element.start,
    end: node.end - element.start,
  });
  const elementText = textOf(code, element);
  const text = apply(
    elementText,
    drop.map((a) => removeAttribute(elementText, local(a))),
  );
  const kept = (opening["attributes"] as Node[]).filter((a) => !drop.includes(a));
  const keptText = kept.map((a) => textOf(code, a)).join(" ");
  const nameNode = local(opening["name"] as Node);
  const renamed = (): string => text.slice(0, nameNode.start) + icon + text.slice(nameNode.end);
  const match = /<(\w+)([^>]*)\s*\/>/.exec(usage);
  if (!match) return { icon, text: renamed() };
  const [, tag, rest] = match as unknown as [string, string, string];
  if (tag === "ICON")
    return { icon, text: keptText.trim() ? `<${icon} ${keptText} />` : renamed() };
  const ownNames = new Set(
    kept.flatMap((a) => (a.type === "JSXAttribute" ? [nameOf(code, a["name"] as Node)] : [])),
  );
  const props = [
    ...rest
      .replace(/\{ICON\}/g, `{${icon}}`)
      .trim()
      .split(/\s+(?=\w+=)/)
      .filter((prop) => {
        const key = prop.split("=")[0];
        return key && !ownNames.has(key);
      }),
    keptText,
  ]
    .filter(Boolean)
    .join(" ");
  return { icon, text: `<${tag} ${props} />` };
}

/** The placeholder's import gone, and the icons imported after the last import. */
function withIconImports(
  code: string,
  icons: readonly string[],
  imports: readonly string[],
): string {
  let out = code;
  for (;;) {
    const program = parse(out);
    if (!program) return out;
    const placeholder = importsOf(program).find((node) =>
      textOf(out, node["source"] as Node).includes("icon-placeholder"),
    );
    if (placeholder === undefined) break;
    const next = removePlaceholderImport(out, program, placeholder);
    if (next === out) break;
    out = next;
  }
  if (icons.length === 0) return out;
  const first = (() => {
    const program = parse(out);
    return program ? importsOf(program)[0] : undefined;
  })();
  const semicolons = first === undefined || textOf(out, first).endsWith(";");
  for (const line of imports) {
    const parts = /import\s+{([^}]+)}\s+from\s+['"]([^'"]+)['"]/.exec(line);
    if (!parts) continue;
    const specifiers = (parts[1] as string)
      .split(",")
      .map((s) => s.trim())
      .flatMap((s) => (s === "ICON" ? [...icons] : [s]));
    let statement = `import { ${specifiers.join(", ")} } from "${parts[2] as string}";`;
    if (!semicolons && !specifiers.some((s) => s.startsWith("{")))
      statement = statement.replace(";", "");
    out = insertImport(out, statement);
  }
  return out;
}

/** The placeholder's import removed: its specifier, or the whole declaration. */
function removePlaceholderImport(code: string, program: Node, declaration: Node): string {
  const specifiers = (declaration["specifiers"] as Node[]).filter(
    (s) => s.type === "ImportSpecifier",
  );
  const names = specifiers.map((s) => {
    const imported = s["imported"] as Node;
    return isString(imported) ? (imported["value"] as string) : textOf(code, imported);
  });
  const at = names.indexOf("IconPlaceholder");
  if (at !== -1 && specifiers.length > 1) {
    const target = specifiers[at] as Node;
    const next = specifiers[at + 1];
    const previous = specifiers[at - 1];
    return next !== undefined
      ? apply(code, [{ start: target.start, end: next.start, text: "" }])
      : apply(code, [{ start: (previous as Node).end, end: target.end, text: "" }]);
  }
  if (at === -1 && specifiers.length > 0) return code;
  return removeStatement(code, program, declaration);
}

/** A whole top-level statement removed with its line (shadcn's statement removal). */
function removeStatement(code: string, program: Node, statement: Node): string {
  const body = program["body"] as Node[];
  const index = body.indexOf(statement);
  const previous = body[index - 1];
  const next = body[index + 1];
  const lineEnd = (at: number): number => {
    let n = at;
    while (n < code.length && code[n] !== "\n" && code[n] !== "\r") n++;
    return n;
  };
  const isNewline = (at: number): boolean =>
    code[at] === "\n" || (code[at] === "\r" && code[at + 1] === "\n");
  let start: number;
  if (previous) {
    const end = lineEnd(previous.end);
    start = isNewline(end) ? end : previous.end;
  } else start = statement.start;
  const end = lineEnd(statement.end);
  let stop: number;
  if (previous && next) {
    stop = next.start;
    while (stop > 0 && (code[stop - 1] === " " || code[stop - 1] === "\t")) stop--;
  } else if (statement.end === code.length) stop = statement.end;
  else if (isNewline(end)) {
    let after = end;
    for (let at = end; at < code.length; at++) {
      if (code[at] === " " || code[at] === "\t") continue;
      if (isNewline(at)) {
        at += code[at] === "\r" ? 1 : 0;
        after = at + 1;
        continue;
      }
      break;
    }
    if (previous) {
      let back = after;
      while (back > 0) {
        back--;
        if (code[back] === "\n") {
          back = code[back - 1] === "\r" ? back - 1 : back;
          break;
        }
      }
      stop = back;
    } else stop = after;
  } else stop = previous ? statement.end : end;
  const declares = (node: Node | undefined): boolean => {
    const inner =
      node?.type === "ExportNamedDeclaration" || node?.type === "ExportDefaultDeclaration"
        ? (node["declaration"] as Node | null)
        : node;
    return (
      inner?.type === "FunctionDeclaration" ||
      inner?.type === "ClassDeclaration" ||
      inner?.type === "TSInterfaceDeclaration" ||
      inner?.type === "TSEnumDeclaration" ||
      (inner?.type === "TSModuleDeclaration" && inner["body"] != null)
    );
  };
  const text = previous && next ? (declares(previous) || declares(next) ? "\n\n" : "\n") : "";
  return apply(code, [{ start, end: stop, text }]);
}

/** An import inserted after the last import, on its own line, as shadcn writes it. */
function insertImport(code: string, statement: string): string {
  const program = parse(code);
  if (!program) return code;
  const body = program["body"] as Node[];
  let index = 0;
  body.forEach((node, at) => {
    if (node.type === "ImportDeclaration") index = at + 1;
  });
  const previous = body[index - 1];
  const next = body[index];
  const from = previous ? previous.end : 0;
  // The next statement's line, its leading comments included.
  let to = next ? leadingStart(code, from, next) : code.length;
  while (to > 0 && (code[to - 1] === " " || code[to - 1] === "\t")) to--;
  let text = "";
  if (previous && previous.type !== "ImportDeclaration") text += "\n\n";
  else if (from !== 0) text += "\n";
  text += statement;
  text += next && next.type !== "ImportDeclaration" ? "\n\n" : "\n";
  return apply(code, [{ start: from, end: to, text }]);
}

/** Where a statement's leading comments start, after `from`. */
function leadingStart(code: string, from: number, node: Node): number {
  let at = from;
  let first = node.start;
  while (at < node.start) {
    if (code.startsWith("//", at)) {
      if (first === node.start) first = at;
      while (at < node.start && code[at] !== "\n") at++;
    } else if (code.startsWith("/*", at)) {
      if (first === node.start) first = at;
      const close = code.indexOf("*/", at + 2);
      at = close === -1 ? node.start : close + 2;
    } else at++;
  }
  return first;
}

// ── Menus ─────────────────────────────────────────────────────────────────────────────────

function transformMenu(
  code: string,
  color: string,
  merge: (a: string, b: string) => string,
): string {
  const translucent = color === "default-translucent" || color === "inverted-translucent";
  const inverted = color === "inverted" || color === "inverted-translucent";
  let out = code;
  let program = parse(out);
  if (!program) return out;
  let list = attributes(program);
  for (let index = 0; index < list.length; index++) {
    const { attribute } = list[index] as { attribute: Node };
    if (nameOf(out, attribute["name"] as Node) !== "className") continue;
    const value = attribute["value"] as Node | null;
    if (!value) continue;
    const text = textOf(out, value);
    if (!text.includes("cn-menu-target") && !text.includes("cn-menu-translucent")) continue;
    let next = text;
    let tidy = false;
    if (inverted) next = next.replace(/cn-menu-target/g, "dark");
    else {
      next = next.replace(/cn-menu-target/g, "");
      tidy = true;
    }
    if (translucent) {
      next = next.replace(
        /"([^"]*cn-menu-translucent[^"]*)"/g,
        (_all, classes: string) =>
          `"${merge(classes, TRANSLUCENT)
            .replace(/\s*\bcn-menu-translucent\b\s*/g, " ")
            .trim()}"`,
      );
    } else if (next.includes("cn-menu-translucent")) {
      next = next.replace(/cn-menu-translucent/g, "");
      tidy = true;
    }
    if (tidy) {
      next = next
        .replace(/\s{2,}/g, " ")
        .replace(/"\s+/g, '"')
        .replace(/\s+"/g, '"')
        .replace(/,\s*""\s*,/g, ",")
        .replace(/\(\s*""\s*,/g, "(")
        .replace(/,\s*""\s*\)/g, ")");
    }
    out = apply(out, [
      {
        start: value.start,
        end: value.end,
        // shadcn writes the new value through its code writer twice, at the attribute's place and
        // then at the value's, each indenting every further line of a value of several lines by
        // what its writer counts as the place's indentation: for an attribute on a line indented
        // n spaces, 2n - 2 at the attribute and 2n - 6 at its value (as measured over every menu
        // of both styles' items, and held to shadcn's own output by `shadcn-style.test.ts`).
        text: reindent(
          out,
          value.start,
          (n) => 2 * n - 6,
          reindent(out, attribute.start, (n) => 2 * n - 2, next),
        ),
      },
    ]);
    program = parse(out);
    if (!program) return out;
    list = attributes(program);
  }
  return out;
}

// ── Right to left ─────────────────────────────────────────────────────────────────────────

/**
 * Text written at `at` as shadcn's code writer (code-block-writer) writes it there: every line
 * after the first, but those that start inside a string, is indented by `indent` of the width of
 * the line `at` is on.
 */
function reindent(
  code: string,
  at: number,
  indent: (width: number) => number,
  text: string,
): string {
  if (!text.includes("\n")) return text;
  let lineStart = at;
  while (lineStart > 0 && code[lineStart - 1] !== "\n") lineStart--;
  let width = 0;
  for (let index = lineStart; index < code.length; index++) {
    const char = code[index];
    if (char === " ") width += 1;
    else if (char === "\t") width += 4 - (width % 4);
    else break;
  }
  const prefix = " ".repeat(Math.max(0, indent(width)));
  let quote: string | undefined;
  const lines = text.split(/\r?\n/);
  return lines
    .map((line, index) => {
      const inString = quote !== undefined;
      for (let i = 0; i < line.length; i++) {
        const char = line[i] as string;
        if (quote !== undefined) {
          if (char === "\\") i++;
          else if (char === quote) quote = undefined;
        } else if (char === '"' || char === "'" || char === "`") quote = char;
      }
      // A line break ends a quoted string that didn't (not a template).
      const wasInString = inString;
      if (quote === '"' || quote === "'") quote = undefined;
      return index === 0 || line.length === 0 || wasInString ? line : prefix + line;
    })
    .join("\n");
}

const LOGICAL: readonly (readonly [string, string])[] = [
  ["-ml-", "-ms-"],
  ["-mr-", "-me-"],
  ["ml-", "ms-"],
  ["mr-", "me-"],
  ["pl-", "ps-"],
  ["pr-", "pe-"],
  ["-left-", "-start-"],
  ["-right-", "-end-"],
  ["left-", "start-"],
  ["right-", "end-"],
  ["inset-l-", "inset-inline-start-"],
  ["inset-r-", "inset-inline-end-"],
  ["rounded-tl-", "rounded-ss-"],
  ["rounded-tr-", "rounded-se-"],
  ["rounded-bl-", "rounded-es-"],
  ["rounded-br-", "rounded-ee-"],
  ["rounded-l-", "rounded-s-"],
  ["rounded-r-", "rounded-e-"],
  ["border-l-", "border-s-"],
  ["border-r-", "border-e-"],
  ["border-l", "border-s"],
  ["border-r", "border-e"],
  ["text-left", "text-start"],
  ["text-right", "text-end"],
  ["scroll-ml-", "scroll-ms-"],
  ["scroll-mr-", "scroll-me-"],
  ["scroll-pl-", "scroll-ps-"],
  ["scroll-pr-", "scroll-pe-"],
  ["float-left", "float-start"],
  ["float-right", "float-end"],
  ["clear-left", "clear-start"],
  ["clear-right", "clear-end"],
  ["origin-top-left", "origin-top-start"],
  ["origin-top-right", "origin-top-end"],
  ["origin-bottom-left", "origin-bottom-start"],
  ["origin-bottom-right", "origin-bottom-end"],
  ["origin-left", "origin-start"],
  ["origin-right", "origin-end"],
];
const FLIPPED: readonly (readonly [string, string])[] = [
  ["-translate-x-", "translate-x-"],
  ["translate-x-", "-translate-x-"],
];
const REVERSED: readonly (readonly [string, string])[] = [
  ["space-x-", "space-x-reverse"],
  ["divide-x-", "divide-x-reverse"],
];
const CURSORS: readonly (readonly [string, string])[] = [
  ["cursor-w-resize", "cursor-e-resize"],
  ["cursor-e-resize", "cursor-w-resize"],
];
const SLIDES: readonly (readonly [string, string, string])[] = [
  ["data-[side=inline-start]", "slide-in-from-right", "slide-in-from-end"],
  ["data-[side=inline-start]", "slide-out-to-right", "slide-out-to-end"],
  ["data-[side=inline-end]", "slide-in-from-left", "slide-in-from-start"],
  ["data-[side=inline-end]", "slide-out-to-left", "slide-out-to-start"],
];
const SIDED = ["ContextMenuContent", "ContextMenuSubContent", "DropdownMenuSubContent"];
const SIDES: Readonly<Record<string, string>> = { right: "inline-end", left: "inline-start" };
const PHYSICAL = ["-left-", "-right-", "left-", "right-"];

/** A class as its variants, its utility and its opacity (`hover:bg-muted/50`). */
function splitClass(token: string): [string | null, string, string | null] {
  if (!token.includes("/") && !token.includes(":")) return [null, token, null];
  let split = -1;
  let depth = 0;
  for (let at = token.length - 1; at >= 0; at--) {
    const char = token[at];
    if (char === "]") depth++;
    else if (char === "[") depth--;
    else if (char === ":" && depth === 0) {
      split = at;
      break;
    }
  }
  const variants = split === -1 ? null : token.slice(0, split);
  const utility = split === -1 ? token : token.slice(split + 1);
  const slash = utility.lastIndexOf("/");
  if (slash === -1) return [variants, utility, null];
  return [variants, utility.slice(0, slash), utility.slice(slash + 1)];
}

/** One class list written right to left (shadcn's `applyRtlMapping`). */
function rtlClasses(classes: string): string {
  return classes
    .split(" ")
    .flatMap((token) => {
      if (token.startsWith("rtl:") || token.startsWith("ltr:")) return [token];
      if (token === "cn-rtl-flip") return ["rtl:rotate-180"];
      const [variants, utility, opacity] = splitClass(token);
      if (!utility) return [token];
      const tail = opacity ? `/${opacity}` : "";
      for (const [from, to] of FLIPPED) {
        if (utility.startsWith(from)) {
          const flipped = utility.replace(from, to);
          return [token, variants ? `rtl:${variants}:${flipped}${tail}` : `rtl:${flipped}${tail}`];
        }
      }
      for (const [from, to] of REVERSED) {
        if (utility.startsWith(from))
          return [token, variants ? `rtl:${variants}:${to}` : `rtl:${to}`];
      }
      for (const [from, to] of CURSORS) {
        if (utility === from) return [token, variants ? `rtl:${variants}:${to}` : `rtl:${to}`];
      }
      for (const [variant, from, to] of SLIDES) {
        if (variants?.includes(variant) && utility.startsWith(from)) {
          const slid = utility.replace(from, to);
          return [opacity ? `${variants}:${slid}/${opacity}` : `${variants}:${slid}`];
        }
      }
      const sided =
        variants?.includes("data-[side=left]") || variants?.includes("data-[side=right]");
      let logical = utility;
      for (const [from, to] of LOGICAL) {
        if (sided && PHYSICAL.some((p) => from.startsWith(p))) continue;
        if (!utility.startsWith(from)) continue;
        if (!from.endsWith("-") && utility !== from) continue;
        logical = utility.replace(from, to);
        break;
      }
      return [
        variants
          ? opacity
            ? `${variants}:${logical}/${opacity}`
            : `${variants}:${logical}`
          : opacity
            ? `${logical}/${opacity}`
            : logical,
      ];
    })
    .join(" ");
}

/** The string literals among an expression's branches (shadcn's class-argument rule). */
function branches(node: Node, binary: boolean): Node[] {
  const parts =
    node.type === "ConditionalExpression"
      ? [node["test"], node["consequent"], node["alternate"]]
      : binary &&
          (node.type === "BinaryExpression" ||
            node.type === "LogicalExpression" ||
            node.type === "AssignmentExpression")
        ? [node["left"], node["right"]]
        : [node];
  return (parts as Node[]).filter((part) => isString(part));
}

/** The properties of every object in `node` (itself included), by position. */
function properties(node: Node): Node[] {
  return all(node, (n) => n.type === "ObjectExpression")
    .flatMap((object) => (object["properties"] as Node[]).filter((p) => p.type === "Property"))
    .sort((a, b) => a.start - b.start);
}

function transformRtl(code: string): string {
  const program = parse(code);
  if (!program) return code;
  const strings = new Strings(code, program);
  const targets: Node[] = [];
  const calls = all(program, (node) => node.type === "CallExpression");
  for (const call of calls) {
    if (nameOf(code, call["callee"] as Node) !== "cva") continue;
    const [base, config] = call["arguments"] as Node[];
    if (isString(base)) targets.push(base);
    if (config?.type !== "ObjectExpression") continue;
    const variants = properties(config).find((p) => keyOf(code, p) === "variants");
    for (const group of variants ? properties(variants) : []) {
      for (const entry of properties(group))
        if (isString(entry["value"] as Node)) targets.push(entry["value"] as Node);
    }
  }
  for (const { attribute } of attributes(program)) {
    const name = nameOf(code, attribute["name"] as Node);
    const value = attribute["value"] as Node | null;
    if (name === "className") {
      if (isString(value)) targets.push(value);
      if (value?.type === "JSXExpressionContainer") {
        const cn = all(value, (n) => n.type === "CallExpression").find(
          (n) => nameOf(code, n["callee"] as Node) === "cn",
        );
        for (const argument of (cn?.["arguments"] as Node[] | undefined) ?? [])
          targets.push(...branches(argument, true));
      }
    }
    if (name === "classNames" && value?.type === "JSXExpressionContainer") {
      for (const property of properties(attribute)) {
        const inner = property["value"] as Node;
        if (inner.type === "CallExpression") {
          for (const argument of inner["arguments"] as Node[])
            targets.push(...branches(argument, false));
        }
        if (isString(inner) && keyOf(code, property) !== "variant") targets.push(inner);
      }
    }
  }
  for (const call of calls) {
    const [first] = call["arguments"] as Node[];
    if (nameOf(code, call["callee"] as Node) !== "mergeProps" || first?.type !== "ObjectExpression")
      continue;
    const property = (first["properties"] as Node[])
      .filter((p) => p.type === "Property")
      .find((p) => keyOf(code, p) === "className");
    if (!property) continue;
    const value = property["value"] as Node;
    if (isString(value)) targets.push(value);
    else if (value.type === "CallExpression" && nameOf(code, value["callee"] as Node) === "cn") {
      for (const argument of value["arguments"] as Node[])
        targets.push(...branches(argument, true));
    }
  }
  for (const target of targets) strings.set(target, rtlClasses(strings.get(target)));
  // `side="right"` on menus that open sideways, as a prop and as a component's default.
  const sides: Node[] = [];
  for (const element of all(program, (n) => n.type === "JSXOpeningElement")) {
    if (!SIDED.includes(nameOf(code, element["name"] as Node))) continue;
    const side = (element["attributes"] as Node[]).find(
      (a) => a.type === "JSXAttribute" && nameOf(code, a["name"] as Node) === "side",
    );
    const value = side?.["value"] as Node | null | undefined;
    if (isString(value)) sides.push(value);
  }
  const functions = all(program, (n) => n.type === "FunctionDeclaration");
  for (const pattern of all(
    program,
    (n) => n.type === "ObjectPattern" || n.type === "ArrayPattern",
  )) {
    const items =
      pattern.type === "ObjectPattern"
        ? (pattern["properties"] as Node[]).map((p) =>
            p.type === "Property" ? (p["value"] as Node) : p,
          )
        : (pattern["elements"] as (Node | null)[]).filter((e): e is Node => e !== null);
    for (const item of items) {
      if (item.type !== "AssignmentPattern") continue;
      if (textOf(code, item["left"] as Node) !== "side" || !isString(item["right"] as Node))
        continue;
      const owner = functions.filter((f) => f.start <= item.start && item.end <= f.end).at(-1);
      const name = (owner?.["id"] as Node | null | undefined)?.["name"] as string | undefined;
      if (name && SIDED.includes(name)) sides.push(item["right"] as Node);
    }
  }
  const sideEdits = sides.flatMap((node) => {
    const now = SIDES[textOf(code, node).replace(/^["']|["']$/g, "")];
    return now ? [{ start: node.start, end: node.end, text: `"${now}"` }] : [];
  });
  return apply(code, [...strings.edits(), ...sideEdits]);
}

// ── The pipeline ──────────────────────────────────────────────────────────────────────────

const MARKER = /\bcn-[a-z-]+\b/;
const KEPT = new Set(["cn-font-heading"]);

/** A styled item's file as shadcn 4.23.0's CLI writes it, its imports already pointed home. */
export function shadcnStyleTransform(
  code: string,
  options: StyleOptions,
  /** tailwind-merge's merge, for translucent menus (the `cn` package's `twMerge`). */
  merge: (a: string, b: string) => string,
): string {
  let out = transformIcons(code, options.iconLibrary);
  out = transformMenu(out, options.menuColor, merge);
  if (options.rtl) out = transformRtl(out);
  out = rewriteClasses(
    out,
    (value) => /\bcn-font-heading\b/.test(value),
    (value) =>
      value
        .replace(/\bcn-font-heading\b/g, options.fontHeading ? "font-heading" : "")
        .replace(/\s+/g, " ")
        .trim(),
  );
  const stray = (token: string): boolean => MARKER.test(token) && !KEPT.has(token);
  out = rewriteClasses(
    out,
    (value) => value.split(/\s+/).some(stray),
    (value) =>
      value
        .split(/\s+/)
        .filter((token) => token.length > 0 && !stray(token))
        .join(" "),
  );
  return out;
}
