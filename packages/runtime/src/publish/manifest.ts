/**
 * Static manifest extraction (D51, AU-07): reads an entry's manifest without running any of the
 * artifact's code. A TSX or JSX entry is parsed with Oxc and its `export const artifact =
 * defineArtifact({...})` is read as a literal; an MDX entry's YAML frontmatter is the manifest.
 * Values that need evaluation are `MOSTRA_MANIFEST_NOT_LITERAL`; values the manifest doesn't allow
 * are `MOSTRA_MANIFEST_INVALID`; unknown keys are `MOSTRA_MANIFEST_UNKNOWN_KEY` warnings.
 */
import {
  ARTIFACT_MANIFEST_KEYS,
  ArtifactManifest,
  createDiagnostic,
  type Diagnostic,
  RpcError,
} from "@mostra/protocol";
import { parseSync } from "oxc-parser";
import { parseDocument } from "yaml";

/** What an entry declares. */
export interface ExtractedManifest {
  /** The validated manifest, or `undefined` when the entry declares none (defaults apply). */
  readonly manifest: ArtifactManifest | undefined;
  /** Whether the entry has a default export (the page, or with `pages/` the layout). */
  readonly hasDefaultExport: boolean;
  /** Warnings, such as unknown keys. */
  readonly warnings: readonly Diagnostic[];
}

interface Node {
  readonly type: string;
  readonly start: number;
  readonly end: number;
  readonly [key: string]: unknown;
}

const REACT_PACKAGE = "@mostra/react";

/** Line and column (1-based) of a UTF-16 offset. */
function position(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (
    let index = text.indexOf("\n");
    index !== -1 && index < offset;
    index = text.indexOf("\n", index + 1)
  ) {
    line += 1;
    lineStart = index + 1;
  }
  return { line, column: offset - lineStart + 1 };
}

class Extraction {
  readonly file: string;
  readonly text: string;

  constructor(file: string, text: string) {
    this.file = file;
    this.text = text;
  }

  fail(
    code: "MOSTRA_MANIFEST_NOT_LITERAL" | "MOSTRA_MANIFEST_INVALID" | "MOSTRA_BUILD_FAILED",
    message: string,
    offset: number,
  ): never {
    throw new RpcError(
      createDiagnostic(code, {
        message,
        location: { file: this.file, ...position(this.text, offset) },
      }),
    );
  }
}

/** Unwraps `( … )`, `x as const`, `x satisfies T` and `x!`. */
function unwrap(node: Node): Node {
  let current = node;
  while (
    current.type === "ParenthesizedExpression" ||
    current.type === "TSAsExpression" ||
    current.type === "TSSatisfiesExpression" ||
    current.type === "TSNonNullExpression"
  ) {
    current = current["expression"] as Node;
  }
  return current;
}

/** Converts a literal expression to its value, or fails with NOT_LITERAL at the first value that isn't one. */
function literal(node: Node, x: Extraction): unknown {
  const value = unwrap(node);
  switch (value.type) {
    case "Literal": {
      const raw = value["value"];
      if (value["regex"] !== undefined || typeof raw === "bigint") {
        return x.fail(
          "MOSTRA_MANIFEST_NOT_LITERAL",
          "A regular expression or BigInt isn't a manifest value.",
          value.start,
        );
      }
      return raw;
    }
    case "TemplateLiteral": {
      const expressions = value["expressions"] as Node[];
      if (expressions.length > 0) {
        return x.fail(
          "MOSTRA_MANIFEST_NOT_LITERAL",
          "A template literal with a placeholder needs evaluation; write the string itself.",
          value.start,
        );
      }
      const [quasi] = value["quasis"] as { value: { cooked: string } }[];
      return quasi?.value.cooked ?? "";
    }
    case "UnaryExpression": {
      const argument = unwrap(value["argument"] as Node);
      if (
        (value["operator"] === "-" || value["operator"] === "+") &&
        argument.type === "Literal" &&
        typeof argument["value"] === "number"
      ) {
        return value["operator"] === "-" ? -argument["value"] : argument["value"];
      }
      return x.fail(
        "MOSTRA_MANIFEST_NOT_LITERAL",
        "Only a sign in front of a number is allowed.",
        value.start,
      );
    }
    case "ArrayExpression":
      return (value["elements"] as (Node | null)[]).map((element) => {
        if (element === null || element.type === "SpreadElement") {
          return x.fail(
            "MOSTRA_MANIFEST_NOT_LITERAL",
            "Arrays in the manifest list their items: no holes or spreads.",
            element?.start ?? value.start,
          );
        }
        return literal(element, x);
      });
    case "ObjectExpression": {
      const result: Record<string, unknown> = {};
      for (const property of value["properties"] as Node[]) {
        if (
          property.type !== "Property" ||
          property["computed"] ||
          property["method"] ||
          property["kind"] !== "init"
        ) {
          return x.fail(
            "MOSTRA_MANIFEST_NOT_LITERAL",
            property.type === "SpreadElement"
              ? "A spread needs evaluation; write the properties out."
              : "Manifest objects have plain `key: value` properties: no computed keys, methods or accessors.",
            property.start,
          );
        }
        if (property["shorthand"]) {
          return x.fail(
            "MOSTRA_MANIFEST_NOT_LITERAL",
            "A shorthand property refers to a variable; write its value.",
            property.start,
          );
        }
        const key = property["key"] as Node;
        const name =
          key.type === "Identifier"
            ? (key["name"] as string)
            : key.type === "Literal"
              ? String(key["value"])
              : undefined;
        if (name === undefined) {
          return x.fail(
            "MOSTRA_MANIFEST_NOT_LITERAL",
            "Property names must be plain names or strings.",
            key.start,
          );
        }
        result[name] = literal(property["value"] as Node, x);
      }
      return result;
    }
    default:
      return x.fail(
        "MOSTRA_MANIFEST_NOT_LITERAL",
        value.type === "Identifier"
          ? `\`${String(value["name"])}\` is a variable; Mostra reads the manifest without running code, so write its value.`
          : "This value needs evaluation; Mostra reads the manifest without running code, so write it as a literal.",
        value.start,
      );
  }
}

interface ModuleFacts {
  /** The node exported as `artifact`, if any: the initializer of the exported (or re-exported) const. */
  readonly artifact: { readonly init: Node | undefined; readonly at: number } | undefined;
  readonly hasDefaultExport: boolean;
  /** Local names bound to `defineArtifact` from `@mostra/react`. */
  readonly defineArtifact: ReadonlySet<string>;
  /** Local namespace names of `@mostra/react`. */
  readonly namespaces: ReadonlySet<string>;
}

function moduleFacts(program: Node): ModuleFacts {
  const body = program["body"] as Node[];
  const defineNames = new Set<string>();
  const namespaces = new Set<string>();
  const locals = new Map<string, { init: Node | undefined; at: number; constant: boolean }>();
  let artifact: ModuleFacts["artifact"];
  let hasDefaultExport = false;
  let exportedLocal: { name: string; at: number } | undefined;

  const declare = (declaration: Node, exported: boolean): void => {
    if (declaration.type !== "VariableDeclaration") return;
    for (const declarator of declaration["declarations"] as Node[]) {
      const id = declarator["id"] as Node;
      if (id.type !== "Identifier") continue;
      const entry = {
        init: (declarator["init"] as Node | null) ?? undefined,
        at: declarator.start,
        constant: declaration["kind"] === "const",
      };
      locals.set(id["name"] as string, entry);
      if (exported && id["name"] === "artifact")
        artifact = { init: entry.constant ? entry.init : undefined, at: entry.at };
    }
  };

  for (const statement of body) {
    if (
      statement.type === "ImportDeclaration" &&
      (statement["source"] as Node)["value"] === REACT_PACKAGE
    ) {
      for (const specifier of statement["specifiers"] as Node[]) {
        const local = (specifier["local"] as Node)["name"] as string;
        if (specifier.type === "ImportNamespaceSpecifier") namespaces.add(local);
        if (specifier.type === "ImportSpecifier") {
          const imported = specifier["imported"] as Node;
          if ((imported["name"] ?? imported["value"]) === "defineArtifact") defineNames.add(local);
        }
      }
    } else if (statement.type === "ExportDefaultDeclaration") {
      hasDefaultExport = true;
    } else if (statement.type === "ExportNamedDeclaration") {
      const declaration = statement["declaration"] as Node | null;
      if (declaration) declare(declaration, true);
      for (const specifier of (statement["specifiers"] as Node[]) ?? []) {
        const exported = specifier["exported"] as Node;
        const name = (exported["name"] ?? exported["value"]) as string;
        const local = (specifier["local"] as Node)["name"] as string;
        if (name === "default") hasDefaultExport = true;
        if (name === "artifact") {
          if (statement["source"]) artifact = { init: undefined, at: specifier.start };
          else exportedLocal = { name: local, at: specifier.start };
        }
      }
    } else {
      declare(statement, false);
    }
  }
  if (exportedLocal) {
    const local = locals.get(exportedLocal.name);
    artifact = {
      init: local?.constant ? local.init : undefined,
      at: local?.at ?? exportedLocal.at,
    };
  }
  return { artifact, hasDefaultExport, defineArtifact: defineNames, namespaces };
}

/** Validates an extracted object as a manifest, with unknown keys as warnings. */
function validate(
  raw: unknown,
  x: Extraction,
  at: number,
): { manifest: ArtifactManifest; warnings: Diagnostic[] } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return x.fail(
      "MOSTRA_MANIFEST_INVALID",
      "The manifest must be an object with at least a title.",
      at,
    );
  }
  const warnings: Diagnostic[] = [];
  const known = new Set<string>(ARTIFACT_MANIFEST_KEYS);
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) {
      warnings.push(
        createDiagnostic("MOSTRA_MANIFEST_UNKNOWN_KEY", {
          message: `The manifest key \`${key}\` isn't one this Mostra release knows; it is ignored.`,
          location: { file: x.file, ...position(x.text, at) },
        }),
      );
    }
  }
  const checked = ArtifactManifest.safeParse(raw);
  if (!checked.success) {
    const issue = checked.error.issues[0];
    const path = issue?.path.join(".") || "(manifest)";
    return x.fail(
      "MOSTRA_MANIFEST_INVALID",
      `The manifest field \`${path}\` is invalid: ${issue?.message ?? "unexpected value"}.`,
      at,
    );
  }
  return { manifest: checked.data, warnings };
}

function extractScript(file: string, text: string): ExtractedManifest {
  const x = new Extraction(file, text);
  const parsed = parseSync(file, text, { lang: file.endsWith(".jsx") ? "jsx" : "tsx" });
  const [error] = parsed.errors;
  if (error) {
    return x.fail(
      "MOSTRA_BUILD_FAILED",
      `${error.message} in ${file}.`,
      error.labels[0]?.start ?? 0,
    );
  }
  const facts = moduleFacts(parsed.program as unknown as Node);
  if (facts.artifact === undefined) {
    return { manifest: undefined, hasDefaultExport: facts.hasDefaultExport, warnings: [] };
  }
  const { init, at } = facts.artifact;
  if (init === undefined) {
    return x.fail(
      "MOSTRA_MANIFEST_NOT_LITERAL",
      "Declare the manifest as `export const artifact = defineArtifact({ ... })` so Mostra can read it without running code.",
      at,
    );
  }
  const call = unwrap(init);
  const callee = call.type === "CallExpression" ? unwrap(call["callee"] as Node) : undefined;
  const isDefineArtifact =
    callee !== undefined &&
    ((callee.type === "Identifier" && facts.defineArtifact.has(callee["name"] as string)) ||
      (callee.type === "MemberExpression" &&
        !callee["computed"] &&
        (callee["object"] as Node).type === "Identifier" &&
        facts.namespaces.has((callee["object"] as Node)["name"] as string) &&
        (callee["property"] as Node)["name"] === "defineArtifact"));
  if (callee?.type === "Identifier" && callee["name"] === "defineArtifact" && !isDefineArtifact) {
    return x.fail(
      "MOSTRA_MANIFEST_INVALID",
      '`defineArtifact` isn\'t imported: add `import { defineArtifact } from "@mostra/react"`.',
      call.start,
    );
  }
  const args = call["arguments"] as Node[] | undefined;
  const [argument] = args ?? [];
  if (
    !isDefineArtifact ||
    args?.length !== 1 ||
    argument === undefined ||
    unwrap(argument).type !== "ObjectExpression"
  ) {
    return x.fail(
      "MOSTRA_MANIFEST_NOT_LITERAL",
      "The exported `artifact` must be `defineArtifact({ ... })` with one object literal.",
      call.start,
    );
  }
  const { manifest, warnings } = validate(literal(argument, x), x, argument.start);
  return { manifest, hasDefaultExport: facts.hasDefaultExport, warnings };
}

/** An MDX entry's frontmatter: a `---` fenced YAML block on the first line. */
function extractFrontmatter(file: string, text: string): ExtractedManifest {
  const x = new Extraction(file, text);
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!match) return { manifest: undefined, hasDefaultExport: true, warnings: [] };
  const yamlText = match[1] ?? "";
  const document = parseDocument(yamlText, { prettyErrors: false, uniqueKeys: true });
  const [error] = document.errors;
  if (error) {
    const offset = 4 + (error.pos[0] ?? 0);
    return x.fail(
      "MOSTRA_MANIFEST_INVALID",
      `The frontmatter isn't valid YAML: ${error.message.split("\n")[0]}`,
      offset,
    );
  }
  const raw = document.toJS() as unknown;
  if (raw === null || raw === undefined)
    return { manifest: undefined, hasDefaultExport: true, warnings: [] };
  const { manifest, warnings } = validate(raw, x, 0);
  return { manifest, hasDefaultExport: true, warnings };
}

/**
 * Reads the manifest of an entry file's `text`. `file` is the entry's path inside the artifact,
 * used for the language and in diagnostics' locations.
 */
export function extractManifest(file: string, text: string): ExtractedManifest {
  return file.endsWith(".mdx") ? extractFrontmatter(file, text) : extractScript(file, text);
}
