#!/usr/bin/env node
/**
 * `pnpm gen <generator>`: start new things in the right shape (REPO_STANDARDS §5).
 *
 *   pnpm gen package <npm-name>                       a package from the package map
 *   pnpm gen diagnostic <CODE> --severity <s> --phase <p> --title <text>
 *                                                     a diagnostic code in its area file
 *   pnpm gen protocol-method <group/name> [--mutating] [--direction instance-to-host]
 *                                                     a host protocol method module
 *
 * Every generator prints what is left to do; `pnpm check` fails until it is done.
 * `--root <dir>` runs against another checkout (the generator tests use it).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { ROOT, runSync } from "../lib/repo.ts";
import { packageRule } from "../package-map.ts";
import { packageFiles } from "./package.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    root: { type: "string" },
    severity: { type: "string" },
    phase: { type: "string" },
    title: { type: "string" },
    mutating: { type: "boolean", default: false },
    direction: { type: "string", default: "client-to-instance" },
  },
});
const root = values.root ?? ROOT;
const [generator, subject] = positionals;

function write(path: string, text: string): void {
  const full = join(root, path);
  if (existsSync(full)) throw new Error(`${path} already exists.`);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
  console.log(`  created ${path}`);
}

/** Inserts `line` before the marker comment in `path`, keeping the marker's indentation. */
function insertAt(path: string, marker: string, line: string, after = false): void {
  const full = join(root, path);
  const text = readFileSync(full, "utf8");
  const index = text.indexOf(`// ${marker}`);
  if (index < 0) throw new Error(`${path} has no "// ${marker}" marker.`);
  const lineStart = text.lastIndexOf("\n", index) + 1;
  const indent = text.slice(lineStart, index);
  if (after) {
    const lineEnd = text.indexOf("\n", index) + 1;
    writeFileSync(full, text.slice(0, lineEnd) + indent + line + "\n" + text.slice(lineEnd));
  } else {
    writeFileSync(full, text.slice(0, lineStart) + indent + line + "\n" + text.slice(lineStart));
  }
  console.log(`  updated ${path}`);
}

const pascal = (text: string): string =>
  text
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join("");
const camel = (text: string): string => {
  const value = pascal(text);
  return value.charAt(0).toLowerCase() + value.slice(1);
};

function generatePackage(name: string): string[] {
  const rule = packageRule(name);
  if (!rule) throw new Error(`${name} is not in tools/package-map.ts. Add it to the map first.`);
  for (const [path, text] of packageFiles(rule)) write(path, text);
  const tsconfig = join(root, "tsconfig.json");
  const solution = JSON.parse(readFileSync(tsconfig, "utf8")) as { references: { path: string }[] };
  if (!solution.references.some((ref) => ref.path === rule.dir)) {
    solution.references.push({ path: rule.dir });
    writeFileSync(tsconfig, `${JSON.stringify(solution, null, 2)}\n`);
    console.log("  updated tsconfig.json");
  }
  return [
    `Run \`pnpm install\`, then replace the placeholder export in ${rule.dir}/src/index.ts with the package's real interface.`,
    `Fill in ${rule.dir}/README.md and AGENTS.md (AGENTS.md prose is reviewed with Mirza, D74).`,
    "Add a changeset (`pnpm changeset`) once the public API exists, then run `pnpm check`.",
  ];
}

const AREA_FILE = "packages/protocol/src/diagnostics/codes";

function generateDiagnostic(code: string): string[] {
  const match = /^MOSTRA_([A-Z0-9]+)_([A-Z0-9_]+)$/.exec(code);
  if (!match) throw new Error(`"${code}" is not of the form MOSTRA_<AREA>_<NAME>.`);
  const area = match[1] ?? "";
  const areas = readFileSync(join(root, "packages/protocol/src/diagnostics/diagnostic.ts"), "utf8");
  if (!areas.includes(`| "${area}"`)) {
    throw new Error(
      `Unknown area ${area}. The areas are listed in INTERFACES §13; extend that list first.`,
    );
  }
  const severity = values.severity ?? "";
  const phase = values.phase ?? "";
  if (!["error", "warning", "hint"].includes(severity))
    throw new Error("--severity must be error, warning or hint.");
  if (!phase) throw new Error("--phase is required (see DiagnosticPhase).");
  const title = values.title ?? "TODO";
  const lower = area.toLowerCase();
  const typeName = `${pascal(lower)}DiagnosticCode`;
  const constName = `${camel(lower)}Diagnostics`;
  const file = `${AREA_FILE}/${lower}.ts`;
  const entry = [
    `${code}: {`,
    `  severity: "${severity}",`,
    `  phase: "${phase}",`,
    `  title: ${JSON.stringify(title)},`,
    `  hint: "TODO",`,
    `  docs: { explanation: "TODO", fix: "TODO" },`,
    `},`,
  ];
  if (!existsSync(join(root, file))) {
    write(
      file,
      [
        "/**",
        ` * Diagnostic codes of the ${area} area.`,
        " */",
        'import type { AreaCatalog } from "../spec.ts";',
        "",
        `/** The codes of the ${area} area, in the order they were added. */`,
        `export const ${camel(lower)}DiagnosticCodes = [`,
        "  // gen:codes",
        "] as const;",
        "",
        `/** The codes of the ${area} area. */`,
        `export type ${typeName} = (typeof ${camel(lower)}DiagnosticCodes)[number];`,
        "",
        `/** The ${area} area's catalog entries. */`,
        `export const ${constName}: AreaCatalog<${typeName}> = {`,
        "  // gen:entries",
        "};",
        "",
      ].join("\n"),
    );
    const index = `${AREA_FILE}/index.ts`;
    insertAt(
      index,
      "gen:area-imports",
      `import { type ${typeName}, ${constName} } from "./${lower}.ts";`,
      true,
    );
    insertAt(
      index,
      "gen:area-exports",
      `export { type ${typeName}, ${camel(lower)}DiagnosticCodes } from "./${lower}.ts";`,
      true,
    );
    insertAt(index, "gen:area-codes", `${typeName} |`, true);
    insertAt(index, "gen:area-spreads", `...${constName},`, true);
  }
  const text = readFileSync(join(root, file), "utf8");
  if (text.includes(`${code}:`)) throw new Error(`${code} already exists in ${file}.`);
  insertAt(file, "gen:codes", `"${code}",`);
  for (const line of entry) insertAt(file, "gen:entries", line);
  return [
    `Write the title, hint and docs text for ${code} in ${file} (diagnostic hints are reviewed with Mirza, D74).`,
    "Run `node tools/docs/diagnostics.ts write` to generate its docs page.",
    `Export ${typeName} and ${camel(lower)}DiagnosticCodes from packages/protocol/src/index.ts if the area is new.`,
    "Add a changeset for @mostra/protocol (the API report lists the new code), then run `pnpm check`.",
  ];
}

function generateMethod(method: string): string[] {
  if (!/^([a-z][a-zA-Z]*\/)?[a-z][a-zA-Z.]*$/.test(method)) {
    throw new Error(`"${method}" is not a method name of the form group/name.`);
  }
  if (!["client-to-instance", "instance-to-host"].includes(values.direction ?? "")) {
    throw new Error("--direction must be client-to-instance or instance-to-host.");
  }
  const [group, name] = method.includes("/") ? method.split("/") : ["root", method];
  const base = pascal(`${group} ${name}`);
  const constName = `${camel(`${group} ${name}`)}Method`;
  const file = `packages/protocol/src/methods/${group}/${(name ?? "").replace(/\./g, "-")}.ts`;
  const requestId = values.mutating
    ? [
        "  /** Makes retries idempotent: a repeated `requestId` returns the recorded result (H-03). */",
        "  readonly requestId?: string;",
      ]
    : [];
  write(
    file,
    [
      'import * as z from "zod";',
      'import { defineMethod, type MethodDefinition } from "../../method.ts";',
      'import { wireRegistry } from "../../wire-registry.ts";',
      "",
      `/** The params of \`${method}\` (INTERFACES §6). */`,
      `export interface ${base}Params {`,
      ...requestId,
      "}",
      "",
      `/** The result of \`${method}\`. */`,
      `export type ${base}Result = Record<string, never>;`,
      "",
      `const params: z.ZodType<${base}Params> = z`,
      "  .object({",
      ...(values.mutating ? ["    requestId: z.string().min(1).exactOptional(),"] : []),
      "  })",
      `  .register(wireRegistry, { id: "${base}Params" });`,
      "",
      `const result: z.ZodType<${base}Result> = z`,
      "  .object({})",
      `  .register(wireRegistry, { id: "${base}Result" });`,
      "",
      `/** \`${method}\`: TODO, one sentence on what it does for the caller. */`,
      `export const ${constName}: MethodDefinition<${base}Params, ${base}Result> = defineMethod({`,
      `  method: "${method}",`,
      `  direction: "${values.direction}",`,
      `  mutating: ${values.mutating},`,
      "  params,",
      "  result,",
      "});",
      "",
    ].join("\n"),
  );
  const relative = `./${group}/${(name ?? "").replace(/\./g, "-")}.ts`;
  insertAt(
    "packages/protocol/src/methods/index.ts",
    "gen:method-imports",
    `import { ${constName} } from "${relative}";`,
  );
  insertAt("packages/protocol/src/methods/index.ts", "gen:methods", `${constName},`);
  insertAt(
    "packages/protocol/src/index.ts",
    "gen:method-exports",
    `export { type ${base}Params, type ${base}Result, ${constName} } from "./methods/${group}/${(name ?? "").replace(/\./g, "-")}.ts";`,
  );
  return [
    `Fill in the params and result in ${file} from INTERFACES §6, with TSDoc on every field.`,
    "Run `pnpm --filter @mostra/protocol gen:schemas` and add a changeset for @mostra/protocol.",
    "Add tests in packages/protocol/test, then run `pnpm check`.",
  ];
}

try {
  let next: string[];
  if (generator === "package" && subject) next = generatePackage(subject);
  else if (generator === "diagnostic" && subject) next = generateDiagnostic(subject);
  else if (generator === "protocol-method" && subject) next = generateMethod(subject);
  else {
    console.error(
      "usage: pnpm gen <package <name> | diagnostic <CODE> | protocol-method <group/name>> [options]",
    );
    process.exit(2);
  }
  runSync(join(ROOT, "node_modules/.bin/biome"), ["check", "--write", "--colors=off", root], {
    cwd: root,
  });
  console.log("\nNext:");
  for (const step of next) console.log(`  - ${step}`);
} catch (error) {
  console.error(`✗ ${(error as Error).message}`);
  process.exit(1);
}
