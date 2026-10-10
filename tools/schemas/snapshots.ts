/**
 * Wire-schema snapshots for one package: generates JSON Schema 2020-12 (published) and draft-07
 * (for Rust's typify) from the package's Zod registries, checks the committed files are current,
 * and checks the change against the base is additive (HO-07).
 *
 * A package opts in with `scripts/wire-schemas.ts`, which exports `bundles` (see
 * {@link WireBundleSource}). The package renders definitions with its own Zod, so tools never mix
 * Zod instances. Files land in `schemas/<name>.schema.json` and `schemas/<name>.draft-07.json`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { mergeBase, readAtRevision } from "../lib/repo.ts";
import type { WorkspacePackage } from "../lib/workspace.ts";
import { type Bundle, compareBundles, newRevisions } from "./compat.ts";

/** What a package's `scripts/wire-schemas.ts` exports, one entry per published bundle. */
export interface WireBundleSource {
  readonly name: string;
  readonly title: string;
  /** The protocol revisions the bundle describes, by surface (`host-protocol`, …). */
  readonly revisions: Readonly<Record<string, string>>;
  /**
   * The named definitions for `target`, with references written through `uri(id)`. Typically
   * `z.toJSONSchema(registry, { target, io: "input", uri }).schemas`.
   */
  definitions(target: Target, uri: (id: string) => string): Record<string, Record<string, unknown>>;
}

/** The JSON Schema dialects emitted. */
export type Target = "draft-2020-12" | "draft-07";

/** Renders one bundle for one target as formatted JSON text. */
export function renderBundle(source: WireBundleSource, target: Target): string {
  const defsKey = target === "draft-07" ? "definitions" : "$defs";
  const schemas = source.definitions(target, (id) => `#/${defsKey}/${id}`);
  const defs: Record<string, unknown> = {};
  for (const id of Object.keys(schemas).sort()) {
    const { $schema: _schema, $id: _id, ...rest } = schemas[id] ?? {};
    defs[id] = rest;
  }
  const bundle = {
    $schema:
      target === "draft-07"
        ? "http://json-schema.org/draft-07/schema#"
        : "https://json-schema.org/draft/2020-12/schema",
    title: source.title,
    "x-mostra-revisions": source.revisions,
    [defsKey]: defs,
  };
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

const fileFor = (name: string, target: Target): string =>
  `schemas/${name}.${target === "draft-07" ? "draft-07" : "schema"}.json`;

async function loadSources(dir: string): Promise<WireBundleSource[]> {
  const script = join(dir, "scripts/wire-schemas.ts");
  if (!existsSync(script)) return [];
  const module = (await import(pathToFileURL(script).href)) as { bundles: WireBundleSource[] };
  return module.bundles;
}

/** Writes the snapshots, refusing a non-additive change unless a revision moved forward. */
export async function writeSchemas(pkg: WorkspacePackage, dir: string): Promise<string[]> {
  const problems = await checkSchemas(pkg, dir, { write: true });
  return problems.filter((problem) => !problem.includes("out of date"));
}

/** Checks the snapshots: current with the source, and additive against the base. */
export async function checkSchemas(
  pkg: WorkspacePackage,
  dir: string,
  options: { write?: boolean; base?: string | undefined } = {},
): Promise<string[]> {
  const problems: string[] = [];
  const base = "base" in options ? options.base : mergeBase();
  for (const source of await loadSources(dir)) {
    for (const target of ["draft-2020-12", "draft-07"] as const) {
      const file = fileFor(source.name, target);
      const path = join(dir, file);
      const rendered = renderBundle(source, target);
      const committed = existsSync(path) ? readFileSync(path, "utf8") : undefined;
      if (committed !== rendered) {
        if (options.write) {
          mkdirSync(join(dir, "schemas"), { recursive: true });
          writeFileSync(path, rendered);
        } else {
          problems.push(
            `${pkg.dir}/${file} is out of date. Run \`pnpm --filter ${pkg.name} gen:schemas\`.`,
          );
        }
      }
      if (target !== "draft-2020-12" || base === undefined) continue;
      const before = readAtRevision(base, `${pkg.dir}/${file}`);
      if (before === undefined) continue;
      const oldBundle = JSON.parse(before) as Bundle;
      const newBundle = JSON.parse(rendered) as Bundle;
      const breaks = compareBundles(oldBundle, newBundle);
      if (breaks.length === 0) continue;
      const revisions = newRevisions(oldBundle, newBundle);
      if (revisions.length > 0) {
        console.log(
          `! ${source.name}: breaking changes under new revision ${revisions.join(", ")}:`,
        );
        for (const item of breaks) console.log(`    ${item.path}: ${item.reason}`);
        continue;
      }
      for (const item of breaks) {
        problems.push(
          `${source.name} ${item.path}: ${item.reason}. Within a revision, schemas change only additively (D32); a breaking change needs a new revision.`,
        );
      }
    }
  }
  return problems;
}
