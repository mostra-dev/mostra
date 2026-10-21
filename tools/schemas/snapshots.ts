/**
 * Wire-schema snapshots for one package: generates JSON Schema 2020-12 (published) and draft-07
 * (for Rust's typify) from the package's Zod registries, checks the committed files are current,
 * and checks the change against the base is additive (HO-07).
 *
 * A package opts in with `scripts/wire-schemas.ts`, which exports `bundles` (see
 * {@link WireBundleSource}). The package renders definitions with its own Zod, so tools never mix
 * Zod instances. Files land in `schemas/<name>.schema.json` and `schemas/<name>.draft-07.json`.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { listAtRevision, mergeBase, readAtRevision } from "../lib/repo.ts";
import type { WorkspacePackage } from "../lib/workspace.ts";
import { type Bundle, compareSnapshots } from "./compat.ts";

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
  /**
   * The protocol's methods by name, each with its direction, whether it mutates, and its params
   * and result as schemas (a reference written through `uri(id)`, or `{}` for any JSON). Clients
   * in other languages (the Rust crate's generator, D143) read them as `x-mostra-methods`.
   */
  methods?(uri: (id: string) => string): Record<string, WireMethod>;
  /** The notifications by name, with their params, as `x-mostra-notifications`. */
  notifications?(uri: (id: string) => string): Record<string, { readonly params: object }>;
}

/** One method of a bundle's `x-mostra-methods`. */
export interface WireMethod {
  readonly direction: string;
  readonly mutating: boolean;
  readonly params: object;
  readonly result: object;
}

/** The JSON Schema dialects emitted. */
export type Target = "draft-2020-12" | "draft-07";

/** Renders one bundle for one target as formatted JSON text. */
export function renderBundle(source: WireBundleSource, target: Target): string {
  const defsKey = target === "draft-07" ? "definitions" : "$defs";
  const uri = (id: string): string => `#/${defsKey}/${id}`;
  const schemas = source.definitions(target, uri);
  const defs: Record<string, unknown> = {};
  for (const id of Object.keys(schemas).sort()) {
    const { $schema: _schema, $id: _id, ...rest } = schemas[id] ?? {};
    defs[id] = rest;
  }
  const sorted = <T>(record: Record<string, T> | undefined): Record<string, T> | undefined =>
    record &&
    Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, record[key] as T]),
    );
  const methods = sorted(source.methods?.(uri));
  const notifications = sorted(source.notifications?.(uri));
  const bundle = {
    $schema:
      target === "draft-07"
        ? "http://json-schema.org/draft-07/schema#"
        : "https://json-schema.org/draft/2020-12/schema",
    title: source.title,
    "x-mostra-revisions": source.revisions,
    ...(methods ? { "x-mostra-methods": methods } : {}),
    ...(notifications ? { "x-mostra-notifications": notifications } : {}),
    [defsKey]: defs,
  };
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

function readIfPresent(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

const fileFor = (name: string, target: Target): string =>
  `schemas/${name}.${target === "draft-07" ? "draft-07" : "schema"}.json`;

async function loadSources(dir: string): Promise<WireBundleSource[]> {
  const script = join(dir, "scripts/wire-schemas.ts");
  if (!existsSync(script)) return [];
  const module = (await import(pathToFileURL(script).href)) as { bundles: WireBundleSource[] };
  return module.bundles;
}

/** The published 2020-12 bundles of `pkgDir` at a Git revision, by bundle name. */
function bundlesAt(revision: string, pkgDir: string): Map<string, Bundle> {
  const bundles = new Map<string, Bundle>();
  for (const file of listAtRevision(revision, `${pkgDir}/schemas`)) {
    const match = /^(.+)\.schema\.json$/.exec(file);
    const text = match ? readAtRevision(revision, `${pkgDir}/schemas/${file}`) : undefined;
    if (match?.[1] && text !== undefined) bundles.set(match[1], JSON.parse(text) as Bundle);
  }
  return bundles;
}

/** Writes the snapshots, refusing a change that breaks the evolution rules against the base. */
export async function writeSchemas(pkg: WorkspacePackage, dir: string): Promise<string[]> {
  const problems = await checkSchemas(pkg, dir, { write: true });
  return problems.filter((problem) => !problem.includes("out of date"));
}

/**
 * Checks the snapshots: current with the source, no stray files, and every change from the base
 * allowed by the evolution rules ({@link compareSnapshots}).
 */
export async function checkSchemas(
  pkg: WorkspacePackage,
  dir: string,
  options: { write?: boolean; base?: string | undefined; today?: string } = {},
): Promise<string[]> {
  const problems: string[] = [];
  const base = "base" in options ? options.base : mergeBase();
  const current = new Map<string, Bundle>();
  const expected = new Set<string>();
  for (const source of await loadSources(dir)) {
    for (const target of ["draft-2020-12", "draft-07"] as const) {
      const file = fileFor(source.name, target);
      expected.add(file);
      const path = join(dir, file);
      const rendered = renderBundle(source, target);
      if (target === "draft-2020-12") current.set(source.name, JSON.parse(rendered) as Bundle);
      if (readIfPresent(path) === rendered) continue;
      if (options.write) {
        mkdirSync(join(dir, "schemas"), { recursive: true });
        writeFileSync(path, rendered);
      } else {
        problems.push(
          `${pkg.dir}/${file} is out of date. Run \`pnpm --filter ${pkg.name} gen:schemas\`.`,
        );
      }
    }
  }
  if (existsSync(join(dir, "schemas"))) {
    for (const file of readdirSync(join(dir, "schemas"))) {
      if (!expected.has(`schemas/${file}`)) {
        problems.push(`${pkg.dir}/schemas/${file} has no bundle in scripts/wire-schemas.ts.`);
      }
    }
  }
  if (base !== undefined) {
    const today = options.today ?? new Date().toISOString().slice(0, 10);
    problems.push(...compareSnapshots(bundlesAt(base, pkg.dir), current, today));
  }
  return problems;
}
