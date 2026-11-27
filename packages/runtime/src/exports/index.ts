/**
 * The page's front end as files (D185 items 7 and 8, VR-07): `artifact/export` with `static`,
 * `html` or `snapshot`. The module gathers what the page loses here (its actions, live producers
 * and Submit), its live values as they are now, a snapshot's answers and who wrote its shared
 * state, rebuilds the demos under `--base` when their source is the version's, then runs the
 * built-in exporter in a plugin child on the version's client files, never its server code
 * (RT-02), and writes what it made beside `out`, moved into place in one rename. Every warning is
 * in the result; `strict` makes them an error and writes nothing.
 *
 * ```ts
 * const exports = createExports({ … });
 * await exports.run({ artifact, as: "static", out: "/tmp/page", base: "/repo/" });
 * ```
 */
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { zstdCompressSync } from "node:zlib";
import {
  type ArtifactExportParams,
  type ArtifactExportResult,
  type ArtifactManifest,
  createDiagnostic,
  type Diagnostic,
  type ExportedDemo,
  type ExportReport,
  isDemoBuild,
  type LiveState,
  RpcError,
} from "@mostra/protocol";
import { PLUGIN_CONTRACTS } from "@mostra/protocol/plugin";
import {
  type DemoInputs,
  type Demos,
  demoBuilds,
  demoDigestOf,
  injectDemoAgent,
} from "../demos/index.ts";
import type { Ledger } from "../ledger/index.ts";
import type { Log } from "../log.ts";
import { fsyncPath, removeTree, renamePath } from "../platform/index.ts";
import { builtinExporter, exportInChild } from "../plugins/index.ts";
import { type ExportableVersion, resolveSource, TAR_END, tarFile } from "../publish/index.ts";

/** The longest a built-in export may take. */
const EXPORT_TIMEOUT_MS = 300_000;
/** The file the built-in exporter reports in, which is never written out. */
const REPORT_FILE = ".mostra-report.json";

/** What {@link createExports} needs of the instance. */
export interface ExportsOptions {
  readonly home: string;
  readonly ledger: Ledger;
  readonly log: Log;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly runtimeVersion: string;
  /** A published version, checked whole (`Publisher.exportable`). */
  readonly exportable: (params: {
    readonly artifact: ArtifactExportParams["artifact"];
    readonly version?: number | string;
  }) => Promise<ExportableVersion>;
  /** The source path an artifact was published from, if this home knows it. */
  readonly sourceOf: (artifactId: string) => string | undefined;
  /** The home's own viewer (the local user). */
  readonly localViewer: () => string;
  /** The artifact's live values as they are now, as the store keeps them. */
  readonly liveValues: (artifactId: string) => readonly {
    readonly key: string;
    readonly revision: number;
    readonly value: string;
    readonly at: string;
  }[];
  readonly demos?: Demos;
}

/** The built-in exports of one instance. */
export interface Exports {
  /** Writes an export; `signal` ends a `--base` rebuild of its demos (the client went away). */
  run(params: ArtifactExportParams, signal?: AbortSignal): Promise<ArtifactExportResult>;
}

interface VersionManifest {
  readonly artifactId: string;
  readonly server?: boolean;
  readonly manifest?: ArtifactManifest;
  readonly environment?: { readonly demoDigest?: string };
}

interface Registry {
  readonly actions?: readonly { readonly export: string }[];
  readonly liveSources?: readonly { readonly key: string }[];
  readonly reviewAgent?: string;
}

interface FieldRow {
  readonly field_id: string;
  readonly value_json: string;
  readonly sensitive: number | null;
  readonly updated_by_json: string | null;
}

/** "1 action", "3 actions". */
function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** "a, b and c". */
function listed(items: readonly string[]): string {
  return items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1) as string}`;
}

/**
 * Makes a copy of a sealed version writable (files 0444 and folders 0555 in the home, DATA_MODEL
 * §1): the export's scratch view replaces its demos with ones built again under `--base`.
 */
async function writableTree(dir: string): Promise<void> {
  await chmod(dir, 0o755);
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await writableTree(path);
    else if (entry.isFile()) await chmod(path, 0o644);
  }
}

/** Creates the built-in exports. */
export function createExports(options: ExportsOptions): Exports {
  const { log, ledger } = options;

  /** The fields of one document of the artifact: a viewer's draft, or its shared state. */
  const fieldsOf = (
    artifactId: string,
    scope: "viewer" | "artifact",
    viewerId?: string,
  ): FieldRow[] =>
    ledger.read((db) =>
      db.all<FieldRow>(
        `SELECT f.field_id, f.value_json, f.sensitive, f.updated_by_json FROM field f
           JOIN document d ON d.id = f.document_id
          WHERE d.artifact_id = ? AND d.scope = ? AND ${scope === "viewer" ? "d.viewer_id = ?" : "d.viewer_id IS NULL"}
            AND f.deleted = 0 ORDER BY f.field_id`,
        ...(scope === "viewer" ? [artifactId, scope, viewerId ?? ""] : [artifactId, scope]),
      ),
    );

  /** How many people other than the home's own viewer wrote the shared state's fields. */
  const peopleIn = (rows: readonly FieldRow[], local: string): number => {
    const people = new Set<string>();
    for (const row of rows) {
      if (row.updated_by_json === null) continue;
      try {
        const actor = JSON.parse(row.updated_by_json) as { kind?: string; id?: string };
        if (actor.kind === "viewer" && actor.id !== undefined && actor.id !== local) {
          people.add(actor.id);
        }
      } catch {
        // An unreadable actor names nobody.
      }
    }
    return people.size;
  };

  /**
   * The other people whose writes made the artifact state up to `revision`: every viewer a
   * `state.changed` event names, the home's own user aside. Compaction removes events, so the
   * authors the state's rows name now count too: the report may count more people, never fewer.
   */
  const peopleUpTo = (artifactId: string, revision: number, local: string): number => {
    const people = new Set<string>();
    const events = ledger.read((db) =>
      db.all<{ actor_json: string | null; payload_json: string }>(
        "SELECT actor_json, payload_json FROM event WHERE artifact_id = ? AND type = 'state.changed'",
        artifactId,
      ),
    );
    for (const event of events) {
      try {
        const actor = JSON.parse(event.actor_json ?? "{}") as { kind?: string; id?: string };
        const payload = JSON.parse(event.payload_json) as { revision?: string };
        if (Number(payload.revision ?? Number.NaN) > revision) continue;
        if (actor.kind === "viewer" && actor.id !== undefined && actor.id !== local) {
          people.add(actor.id);
        }
      } catch {
        // An unreadable event names nobody.
      }
    }
    for (const row of fieldsOf(artifactId, "artifact")) {
      try {
        const actor = JSON.parse(row.updated_by_json ?? "{}") as { kind?: string; id?: string };
        if (actor.kind === "viewer" && actor.id !== undefined && actor.id !== local) {
          people.add(actor.id);
        }
      } catch {
        // As above.
      }
    }
    return people.size;
  };

  /** A snapshot's frozen answers and state (D185 item 7), and what its report says of them. */
  const snapshotOf = (
    artifactId: string,
    params: ArtifactExportParams,
  ): {
    readonly data: Record<string, unknown>;
    readonly report: NonNullable<ExportReport["snapshot"]>;
  } => {
    const at = new Date().toISOString();
    const local = options.localViewer();
    const stateRows = fieldsOf(artifactId, "artifact");
    const included = params.sharedState !== false;
    const leftOut: string[] = [];
    const answers: Record<string, unknown> = {};
    const state: Record<string, unknown> = {};
    // Whose answers the frozen shared state holds: of the submission's own state when the
    // snapshot freezes a submission (review of WP-24, finding 5), else of the state now.
    let people = included ? peopleIn(stateRows, local) : 0;
    if (params.submission !== undefined) {
      const row = ledger.read((db) =>
        db.get<{ snapshot_json: string }>(
          "SELECT snapshot_json FROM submission WHERE id = ? AND artifact_id = ?",
          params.submission ?? "",
          artifactId,
        ),
      );
      if (!row) {
        throw new RpcError(
          createDiagnostic("MOSTRA_HOST_INVALID_PARAMS", {
            message: `The artifact has no submission ${params.submission}.`,
          }),
        );
      }
      const snapshot = JSON.parse(row.snapshot_json) as {
        readonly draft: {
          readonly fields: Record<string, { value: unknown; sensitive?: boolean }>;
        };
        readonly state?: {
          readonly revision: string;
          readonly fields: Record<string, { value: unknown; sensitive?: boolean }>;
        };
      };
      people =
        included && snapshot.state !== undefined && Object.keys(snapshot.state.fields).length > 0
          ? peopleUpTo(artifactId, Number(snapshot.state.revision), local)
          : 0;
      for (const [id, field] of Object.entries(snapshot.draft.fields)) {
        if (field.sensitive) leftOut.push(id);
        else answers[id] = field.value;
      }
      if (included) {
        for (const [id, field] of Object.entries(snapshot.state?.fields ?? {})) {
          if (field.sensitive) leftOut.push(id);
          else state[id] = field.value;
        }
      }
    } else {
      for (const row of fieldsOf(artifactId, "viewer", local)) {
        if (row.sensitive) leftOut.push(row.field_id);
        else answers[row.field_id] = JSON.parse(row.value_json);
      }
      if (included) {
        for (const row of stateRows) {
          if (row.sensitive) leftOut.push(row.field_id);
          else state[row.field_id] = JSON.parse(row.value_json);
        }
      }
    }
    return {
      data: { at, answers, ...(included ? { state } : {}) },
      report: {
        answers: params.submission !== undefined ? "submission" : "viewer",
        ...(params.submission !== undefined ? { submission: params.submission } : {}),
        at,
        sharedState: { included, people },
        live: [],
        leftOut: [...new Set(leftOut)].sort(),
      },
    };
  };

  /**
   * Builds the version's demos again under `base` (D185 item 7) into the scratch view's client
   * files, when the demos' source is the one the version was built from; else says why not.
   */
  const rebuildDemos = async (
    manifest: VersionManifest,
    view: string,
    base: string,
    agent: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<{ readonly rebuilt: boolean; readonly why?: string }> => {
    const builds = demoBuilds(manifest.manifest?.demos);
    if (builds.length === 0) return { rebuilt: true };
    const path = options.sourceOf(manifest.artifactId);
    if (!options.demos || path === undefined) {
      return { rebuilt: false, why: "this home holds no source the version was published from" };
    }
    let root: string;
    try {
      root = (await resolveSource(path)).root;
    } catch {
      return { rebuilt: false, why: `its source ${path} is gone` };
    }
    const current: DemoInputs[] = [];
    try {
      for (const [name, spec] of builds) current.push(await options.demos.inputs(name, spec, root));
    } catch {
      return { rebuilt: false, why: "a demo's source folder is gone" };
    }
    if (demoDigestOf(current) !== manifest.environment?.demoDigest) {
      return { rebuilt: false, why: "the demos' source changed since the version was built" };
    }
    for (const [name, spec] of builds) {
      const inputs = await options.demos.inputs(name, spec, root, `${base}_mostra/demos/${name}/`);
      const target = join(view, "client", "_mostra", "demos", name);
      await removeTree(target);
      // Copied while the cache keeps the build (review of WP-24, finding 2).
      const built = await options.demos.build(inputs, { into: target, signal });
      if (built.status === "failed") return { rebuilt: false, why: built.diagnostic.message };
      if (spec.bridge !== false && agent !== undefined) {
        const code = await readFile(join(view, "client", agent), "utf8").catch(() => undefined);
        if (code !== undefined) await injectDemoAgent(target, code, agent);
      }
    }
    return { rebuilt: true };
  };

  /** Writes the export's files at `out`, whole or not at all. */
  const write = async (
    out: string,
    as: "static" | "html" | "snapshot",
    files: readonly { readonly path: string; readonly data: Buffer }[],
  ): Promise<string[]> => {
    const archive = as === "snapshot" && out.endsWith(".tar.zst");
    const single = as === "html";
    if (existsSync(out)) {
      const empty =
        !archive && !single && (await stat(out)).isDirectory() && (await readdir(out)).length === 0;
      if (!empty) {
        throw new RpcError(
          createDiagnostic("MOSTRA_ARTIFACT_DIR_NOT_EMPTY", {
            message: `${out} already exists; an export is written only to a new path${single ? "" : " or an empty directory"}.`,
          }),
        );
      }
      await rm(out, { recursive: true, force: true });
    }
    await mkdir(dirname(out), { recursive: true });
    const temporary = `${out}.${randomBytes(4).toString("hex")}.tmp`;
    try {
      if (single) {
        const page = files.find((file) => file.path === "index.html");
        if (!page) throw new Error("the exporter wrote no index.html");
        await writeFile(temporary, page.data);
      } else if (archive) {
        const blocks: Buffer[] = [];
        for (const file of files)
          blocks.push(...tarFile({ path: file.path, data: file.data, executable: false }));
        blocks.push(TAR_END);
        await writeFile(temporary, zstdCompressSync(Buffer.concat(blocks)));
      } else {
        for (const file of files) {
          const path = join(temporary, ...file.path.split("/"));
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, file.data);
        }
      }
      fsyncPath(temporary, !single && !archive);
      await renamePath(temporary, out);
    } catch (error) {
      await removeTree(temporary).catch(() => undefined);
      throw error;
    }
    return [out];
  };

  return {
    async run(params, signal) {
      const as = params.as;
      if (as !== "static" && as !== "html" && as !== "snapshot") {
        throw new Error(`the built-in exports make static, html and snapshot, not ${as}`);
      }
      const version = await options.exportable(params);
      const { detail, summary, versionDir } = version;
      const manifest = JSON.parse(
        await readFile(join(versionDir, "manifest.json"), "utf8"),
      ) as VersionManifest;
      const registry = JSON.parse(
        await readFile(join(versionDir, "registry.json"), "utf8").catch(() => "{}"),
      ) as Registry;
      const actions = [...new Set((registry.actions ?? []).map((one) => one.export))].sort();
      const liveKeys = (registry.liveSources ?? []).map((one) => one.key).sort();
      const submit =
        (detail.policy?.policy ?? manifest.manifest?.submission?.policy ?? "once") !== "none";
      const live: LiveState[] = options.liveValues(detail.id).map((value) => ({
        key: value.key,
        revision: String(value.revision),
        at: value.at,
        value: JSON.parse(value.value) as LiveState["value"] & object,
      }));
      const demoSpecs = Object.entries(manifest.manifest?.demos ?? {}).filter(([, spec]) =>
        isDemoBuild(spec),
      );
      const warnings: Diagnostic[] = [];
      // A scratch view of the version: its client files, with demos rebuilt under `base`.
      const scratch = join(
        options.home,
        "cache",
        "staging",
        `export-${randomBytes(6).toString("hex")}`,
      );
      let rebuilt = true;
      try {
        await mkdir(scratch, { recursive: true });
        await cp(join(versionDir, "client"), join(scratch, "client"), { recursive: true });
        await writableTree(join(scratch, "client"));
        await cp(join(versionDir, "manifest.json"), join(scratch, "manifest.json"));
        if (existsSync(join(versionDir, "registry.json"))) {
          await cp(join(versionDir, "registry.json"), join(scratch, "registry.json"));
        }
        if (
          params.base !== undefined &&
          params.base !== "/" &&
          as !== "html" &&
          demoSpecs.length > 0
        ) {
          const outcome = await rebuildDemos(
            manifest,
            scratch,
            params.base,
            registry.reviewAgent,
            signal,
          );
          rebuilt = outcome.rebuilt;
          if (!outcome.rebuilt) {
            // Carried as the version built them: the scratch view still holds those files.
            await removeTree(join(scratch, "client", "_mostra", "demos"));
            await cp(
              join(versionDir, "client", "_mostra", "demos"),
              join(scratch, "client", "_mostra", "demos"),
              {
                recursive: true,
              },
            ).catch(() => undefined);
            for (const [name] of demoSpecs) {
              warnings.push(
                createDiagnostic("MOSTRA_DEMO_NOT_REBUILT", {
                  message: `The demo "${name}" couldn't be rebuilt for ${params.base}: ${outcome.why ?? "its source isn't the version's"}. It is carried as the version built it, which works fully at a host's root.`,
                }),
              );
            }
          }
        }
        const builtBase = params.base !== undefined && rebuilt && as !== "html" ? params.base : "/";
        const snapshot = as === "snapshot" ? snapshotOf(detail.id, params) : undefined;
        const facts = {
          as,
          artifactId: detail.id,
          title: detail.title,
          exportedAt: new Date().toISOString(),
          unavailable: { actions, live: liveKeys, submit },
          live,
          // The base the demos were built for, only when they were (review of WP-24, finding 7):
          // demos carried as built resolve at a host's root.
          ...(params.base !== undefined && rebuilt && as !== "html" ? { base: params.base } : {}),
        };
        const exporter = await builtinExporter(
          options.env,
          as === "html" ? "htmlExporter" : "staticExporter",
        );
        const answer = await exportInChild(
          exporter.dir,
          {
            file: exporter.file,
            export: exporter.export,
            id: as === "html" ? "html" : "static",
            implemented: PLUGIN_CONTRACTS.exporter.implements,
            versionDir: scratch,
            version: {
              artifactId: detail.id,
              versionId: summary.id,
              number: summary.number,
              title: detail.title,
              ...(detail.description !== undefined ? { description: detail.description } : {}),
              manifest: manifest.manifest ?? {},
              registry,
              server: manifest.server === true,
              publishedAt: summary.publishedAt,
            },
            options: {
              facts,
              ...(snapshot ? { snapshot: snapshot.data } : {}),
              demos: demoSpecs.map(([name, spec]) => ({
                name,
                routing: isDemoBuild(spec) ? (spec.routing ?? "history") : "history",
                base: `${builtBase}_mostra/demos/${name}/`,
              })),
            },
            mostraVersion: options.runtimeVersion,
          },
          {
            env: options.env,
            log,
            timeoutMs: EXPORT_TIMEOUT_MS,
            what: `The ${as} export of version ${summary.number}`,
          },
        );
        const files = answer.files.map((file) => ({
          path: file.path,
          data:
            "text" in file ? Buffer.from(file.text, "utf8") : Buffer.from(file.base64, "base64"),
        }));
        const reported = files.find((file) => file.path === REPORT_FILE);
        const made = JSON.parse(reported?.data.toString("utf8") ?? "{}") as {
          notInlined?: string[];
          demos?: ExportedDemo[];
        };
        const demos: ExportedDemo[] = (made.demos ?? []).map((demo) => ({
          ...demo,
          ...(params.base !== undefined && rebuilt && as !== "html"
            ? { base: `${params.base}_mostra/demos/${demo.name}/` }
            : {}),
        }));
        // What the page loses here (D185 item 8), named.
        if (as !== "snapshot" && (actions.length > 0 || liveKeys.length > 0)) {
          const lost = [
            ...(actions.length > 0
              ? [`${counted(actions.length, "action")} (${actions.join(", ")})`]
              : []),
            ...(liveKeys.length > 0
              ? [`${counted(liveKeys.length, "live producer")} (${liveKeys.join(", ")})`]
              : []),
            ...(submit ? ["Submit"] : []),
          ];
          warnings.push(
            createDiagnostic("MOSTRA_TARGET_SERVER_FEATURES", {
              message: `${listed(lost)} won't work in this export. Export a snapshot to keep the answers and state as they are, or a bundle to keep the actions running.`,
            }),
          );
        }
        if ((made.notInlined ?? []).length > 0) {
          warnings.push(
            createDiagnostic("MOSTRA_TARGET_NOT_INLINED", {
              message: `The export needs a network for ${listed(made.notInlined ?? [])}.`,
            }),
          );
        }
        for (const demo of demos) {
          if (demo.carried === "folder-only") {
            warnings.push(
              createDiagnostic("MOSTRA_DEMO_NOT_IN_FILE", {
                message: `The demo "${demo.name}" can't run inside a single file; the page shows a note in its place. Send the folder version: mostra export ${detail.id} --as static.`,
              }),
            );
          } else if (as !== "html" && demo.routing === "history" && params.base === undefined) {
            warnings.push(
              createDiagnostic("MOSTRA_DEMO_BASE_NEEDED", {
                message: `The demo "${demo.name}" moves between pages by browser history: it works fully when the folder is served at a host's root (npx serve <folder>), and on its first page from disk or a subpath. To host the folder at a subpath, export it with --base <path>.`,
              }),
            );
          }
        }
        if (snapshot?.report.sharedState.included && snapshot.report.sharedState.people > 0) {
          warnings.push(
            createDiagnostic("MOSTRA_TARGET_SHARED_STATE", {
              message: `The snapshot's shared state holds answers from ${snapshot.report.sharedState.people} ${snapshot.report.sharedState.people === 1 ? "other person" : "other people"}. Pass --no-shared-state to leave it out.`,
            }),
          );
        }
        const report: ExportReport = {
          as,
          unavailable: { actions, live: liveKeys, submit },
          notInlined: made.notInlined ?? [],
          demos,
          ...(snapshot
            ? { snapshot: { ...snapshot.report, live: live.map((one) => one.key) } }
            : {}),
        };
        if (params.strict && warnings.length > 0) {
          throw new RpcError(
            createDiagnostic("MOSTRA_TARGET_EXPORT_STRICT", {
              message: `The export would lose what its warnings name, so --strict wrote nothing: ${warnings.map((warning) => warning.code).join(", ")}.`,
            }),
          );
        }
        const written = await write(
          params.out,
          as,
          files.filter((file) => file.path !== REPORT_FILE),
        );
        log.info("exports.written", { artifactId: detail.id, versionId: summary.id, as });
        return {
          files: written,
          versionId: summary.id,
          report,
          ...(warnings.length > 0 ? { warnings } : {}),
        };
      } finally {
        await removeTree(scratch).catch(() => undefined);
      }
    },
  };
}
