/**
 * Themes: `theme list` and `theme show`, thin clients of `theme/list` and `theme/show` (D181
 * item 6). `verify --theme` tries a stack before the manifest names it (`authoring.ts`).
 */
import {
  type ThemeListResult,
  type ThemeShowResult,
  themeListMethod,
  themeShowMethod,
} from "@mostra/protocol";
import { type CommandDef, defineCommand } from "../command.ts";
import { EXIT } from "../exit.ts";
import { flag, sourceRef } from "./shared.ts";

/** The theme list for people: each theme, then the artifact's stack. */
function listText(result: ThemeListResult): string {
  const lines = result.themes.map((theme) => {
    const marks = [
      theme.default ? "default" : undefined,
      theme.complete ? undefined : "a layer",
      theme.package,
    ].filter((mark) => mark !== undefined);
    return `${theme.id}  ${theme.name}${marks.length > 0 ? ` (${marks.join(", ")})` : ""}\n    ${theme.description}`;
  });
  if (result.artifact) {
    lines.push(
      `the artifact wears: ${result.artifact.stack.join(", ")}${result.artifact.default ? " (the default; its manifest names none)" : ""}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

/** A stack for people: what it makes, then every value by mode. */
function showText(result: ThemeShowResult): string {
  const lines = [
    `stack: ${result.stack.join(", ")}${result.default ? " (the default)" : ""}`,
    ...(result.name !== undefined ? [`theme: ${result.name} (${result.id})`] : []),
    ...(result.faces
      ? [`faces: ${result.faces.sans}; headings ${result.faces.display}; code ${result.faces.mono}`]
      : []),
    ...(result.files.length > 0 ? [`the artifact's layers: ${result.files.join(", ")}`] : []),
    ...(result.host !== undefined ? [`the host's look: ${result.host} the artifact's layers`] : []),
  ];
  for (const [mode, values] of Object.entries(result.values ?? {})) {
    lines.push(`${mode}:`);
    for (const [name, value] of Object.entries(values)) lines.push(`  ${name}: ${value};`);
  }
  for (const warning of result.warnings)
    lines.push(`${warning.severity} ${warning.code}: ${warning.message}`);
  if (result.css !== undefined) lines.push("", result.css);
  return `${lines.join("\n")}\n`;
}

/** `mostra theme list [--artifact <path|id>]`. */
export const themeListCommand: CommandDef = defineCommand({
  path: ["theme", "list"],
  summary:
    "List the themes a page can wear (kit.theme): the built-in ones and those an artifact's plugins add.",
  flags: [
    {
      name: "artifact",
      kind: "string",
      value: "<path|id>",
      summary: "Also list the themes this artifact's plugins add, and the stack it wears.",
    },
  ],
  output: { type: "ThemeListResult", topic: "cli" },
  exits: [EXIT.failure],
  example: "theme list --artifact ./review",
  async run(context) {
    const artifact = flag(context, "artifact");
    const result = await context.call(themeListMethod, {
      ...(artifact !== undefined ? { artifact: sourceRef(artifact, context.cwd) } : {}),
    });
    return { result, human: listText(result) };
  },
});

/** `mostra theme show [theme…] [--artifact <path|id>] [--css]`. */
export const themeShowCommand: CommandDef = defineCommand({
  path: ["theme", "show"],
  summary:
    "Show what a theme or a stack sets (faces, every token in light and dark), or what an artifact wears.",
  args: [
    {
      name: "theme",
      summary:
        "A theme, or a stack in order (studio ./brand.css); default: the artifact's own stack.",
      variadic: true,
      optional: true,
    },
  ],
  flags: [
    {
      name: "artifact",
      kind: "string",
      value: "<path|id>",
      summary: "The artifact whose stack to show, or for which to resolve the themes given.",
    },
    { name: "css", kind: "boolean", summary: "Also print the stylesheet the build takes." },
  ],
  output: { type: "ThemeShowResult", topic: "cli" },
  exits: [EXIT.failure],
  example: "theme show arcata --css",
  async run(context) {
    const artifact = flag(context, "artifact");
    const themes = (context.args["theme"] as readonly string[] | undefined) ?? [];
    const result = await context.call(themeShowMethod, {
      ...(themes.length > 0 ? { theme: themes } : {}),
      ...(artifact !== undefined ? { artifact: sourceRef(artifact, context.cwd) } : {}),
      ...(context.flags["css"] === true ? { css: true } : {}),
    });
    return { result, human: showText(result) };
  },
});
