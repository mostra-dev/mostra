/**
 * The plugin system's methods of the host protocol (INTERFACES §14): `plugin/validate`,
 * `plugin/add`, `plugin/list`, `plugin/remove`, `plugin/export` and `plugin/commands`
 * (`pack/add` is the packs module's). Each that names an artifact runs in its source path's queue, as its publishes and
 * `deps/add` do, through the publisher; the home's own plugins have one queue of their own (the
 * working lockfile `home:plugins`).
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rmdir, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import {
  type AppPageResult,
  appPageMethod,
  checkArtifactPath,
  createDiagnostic,
  type McpAppResourceMeta,
  mcpAppUri,
  type PluginExportParams,
  type PluginExportResult,
  type PluginFinding,
  pluginAddMethod,
  pluginCommandsMethod,
  pluginExportMethod,
  pluginListMethod,
  pluginRemoveMethod,
  pluginValidateMethod,
  RpcError,
  type SourceRef,
} from "@mostra/protocol";
import { requestKey } from "../ledger/index.ts";
import type { Log } from "../log.ts";
import { removeTree, renamePath } from "../platform/index.ts";
import { handler, type MethodHandler } from "../protocol-server/index.ts";
import { canonicalRef, type Publisher } from "../publish/index.ts";
import type { Plugins, Scope } from "./plugins.ts";

/** The exporter `app/page` runs: the MCP App exporter (D175 item 2). */
const MCP_APP_EXPORTER = "mcp-app";

const usage = (message: string): RpcError =>
  new RpcError(createDiagnostic("MOSTRA_PLUGIN_SCOPE_INVALID", { message }));

/** The handlers of the plugin system's methods. */
export function pluginMethods(options: {
  readonly plugins: () => Plugins;
  readonly publisher: () => Publisher;
  readonly log: Log;
  /** An artifact's dependencies changed (a dev session reloads, D140 item 12). */
  readonly dependenciesChanged?: (artifact: SourceRef) => void;
  /** The artifact a version belongs to, for `app/page`. */
  readonly versionOwner?: (versionId: string) => string | undefined;
  /** Where `app/page` keeps the MCP Apps it made (`<home>/cache/mcp-app`). */
  readonly cacheDir?: string;
}): MethodHandler[] {
  /** Runs `task` in the scope the params name: exactly one of `artifact` and `home`. */
  const inScope = <T>(
    params: { readonly artifact?: SourceRef; readonly home?: boolean },
    task: (scope: Scope) => Promise<T>,
  ): Promise<T> => {
    if ((params.artifact === undefined) === (params.home !== true)) {
      throw usage("Name exactly one of an artifact (--artifact) and the home (--global).");
    }
    if (params.home === true) return options.publisher().withHome(() => task({ kind: "home" }));
    return options
      .publisher()
      .withArtifact(params.artifact as SourceRef, ({ target }) =>
        task({ kind: "artifact", target }),
      );
  };

  /**
   * Runs an exporter on a version (`plugin/export`): its child gets the version's client files,
   * and every file it returns is checked before any is written (D172 item 11).
   */
  const exportVersion = async (params: PluginExportParams): Promise<PluginExportResult> => {
    const { detail, summary, versionDir } = await options
      .publisher()
      .exportable({ ...params, artifact: canonicalRef(params.artifact) });
    // The version's own plugins, as its lockfile froze them, and the home's (D172 item 9).
    const exporters = await options.plugins().exporters({
      artifactId: detail.id,
      versionDir,
      ...(detail.source !== undefined ? { sourceDir: detail.source } : {}),
    });
    const exporter = exporters.find((candidate) => candidate.id === params.exporter);
    if (exporter === undefined) {
      throw new RpcError(
        createDiagnostic("MOSTRA_PLUGIN_EXPORTER_UNKNOWN", {
          message: `No plugin of ${detail.title}'s version ${summary.number} or of the home contributes the exporter "${params.exporter}"; the exporters available are bundle${exporters.map((candidate) => `, ${candidate.id}`).join("")}.`,
        }),
      );
    }
    if (!isAbsolute(params.out)) {
      throw new RpcError(
        createDiagnostic("MOSTRA_HOST_INVALID_PARAMS", {
          message: "out must be an absolute path.",
        }),
      );
    }
    const existing = await stat(params.out).catch(() => undefined);
    if (
      existing !== undefined &&
      (!existing.isDirectory() || (await readdir(params.out)).length > 0)
    ) {
      throw new RpcError(
        createDiagnostic("MOSTRA_ARTIFACT_DIR_NOT_EMPTY", {
          message: `${params.out} already exists${existing.isDirectory() ? " and isn't empty" : ""}.`,
        }),
      );
    }
    const registry = await readFile(join(versionDir, "registry.json"), "utf8")
      .then((text) => JSON.parse(text) as Record<string, unknown>)
      .catch(() => ({}));
    const answer = await options.plugins().runExport({
      exporter,
      versionDir,
      version: {
        artifactId: detail.id,
        versionId: summary.id,
        number: summary.number,
        title: detail.title,
        ...(detail.description !== undefined ? { description: detail.description } : {}),
        manifest: detail.manifest ?? {},
        registry,
        server: existsSync(join(versionDir, "server", "entry.mjs")),
        publishedAt: summary.publishedAt,
      },
      options: params.options ?? {},
    });
    const fail = (reason: string): RpcError =>
      new RpcError(
        createDiagnostic("MOSTRA_PLUGIN_FAILED", {
          message: `The exporter ${exporter.id} (${exporter.package}) ${reason}. Nothing was written.`,
        }),
      );
    // Every file stays inside the export, with a name every system holds, and no file stands
    // where another needs a directory; nothing is written until all of them are checked.
    const planned: { path: string; data: Buffer | string }[] = [];
    const seen = new Set<string>();
    for (const file of answer.files) {
      const check = checkArtifactPath(file.path);
      if (!check.ok) {
        throw fail(
          `returned the file "${file.path.slice(0, 200)}", which isn't a path inside its output`,
        );
      }
      if (seen.has(check.path.toLowerCase())) {
        throw fail(`returned the file "${check.path}" twice`);
      }
      seen.add(check.path.toLowerCase());
      planned.push({
        path: check.path,
        data: "text" in file ? file.text : Buffer.from(file.base64, "base64"),
      });
    }
    for (const file of planned) {
      const segments = file.path.toLowerCase().split("/");
      for (let length = 1; length < segments.length; length += 1) {
        if (seen.has(segments.slice(0, length).join("/"))) {
          throw fail(
            `returned both "${segments.slice(0, length).join("/")}" and "${file.path}", a file where a directory must be`,
          );
        }
      }
    }
    if (answer.output.layout === "file" && planned.length !== 1) {
      throw fail(`writes one file (its output's layout is "file"), and returned ${planned.length}`);
    }
    // Written beside `out` and moved into place in one rename: a failure leaves nothing.
    const scratch = `${params.out}.mostra-${randomBytes(6).toString("hex")}.tmp`;
    const written: string[] = [];
    try {
      if (answer.output.layout === "file") {
        const only = planned[0] as { path: string; data: Buffer | string };
        await mkdir(dirname(params.out), { recursive: true });
        await writeFile(scratch, only.data);
        if (existing !== undefined) await rmdir(params.out);
        await renamePath(scratch, params.out);
        written.push(params.out);
      } else {
        for (const file of planned) {
          const path = join(scratch, ...file.path.split("/"));
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, file.data);
          written.push(join(params.out, ...file.path.split("/")));
        }
        await mkdir(dirname(params.out), { recursive: true });
        if (existing !== undefined) await rmdir(params.out);
        await renamePath(scratch, params.out);
      }
    } catch (problem) {
      await removeTree(scratch).catch(() => undefined);
      throw fail(
        `couldn't be written (${problem instanceof Error ? problem.message : String(problem)})`,
      );
    }
    options.log.info("plugins.exported", {
      artifactId: detail.id,
      versionId: summary.id,
      exporter: exporter.id,
      files: written.length,
    });
    const findings: PluginFinding[] = answer.findings.flatMap((value: unknown) => {
      const finding = value as Partial<PluginFinding>;
      if (typeof finding.code !== "string" || typeof finding.message !== "string") return [];
      return [
        {
          code: finding.code.slice(0, 64),
          severity:
            finding.severity === "error" || finding.severity === "hint"
              ? finding.severity
              : "warning",
          message: finding.message,
          ...(typeof finding.hint === "string" ? { hint: finding.hint } : {}),
        },
      ];
    });
    const entry =
      answer.output.layout === "file"
        ? params.out
        : answer.entry !== undefined && seen.has(answer.entry.toLowerCase())
          ? join(params.out, ...answer.entry.split("/"))
          : undefined;
    return {
      files: written,
      ...(entry !== undefined ? { entry } : {}),
      versionId: summary.id,
      exporter: { id: exporter.id, package: exporter.package },
      findings,
    };
  };

  /** The MCP App pages being exported now, by cache directory: one export each at a time. */
  const exporting = new Map<string, Promise<AppPageResult>>();

  /**
   * `app/page` (D175 items 1, 4): a version's MCP App from the `mcp-app` exporter (the bundled
   * one unless the artifact or the home has its own), kept by version and exporter, since a
   * version never changes.
   */
  const appPage = async (versionId: string): Promise<AppPageResult> => {
    const artifactId = options.versionOwner?.(versionId);
    if (artifactId === undefined || options.cacheDir === undefined) {
      throw new RpcError(
        createDiagnostic("MOSTRA_ARTIFACT_VERSION_NOT_FOUND", {
          message: `This home has no version ${versionId}.`,
        }),
      );
    }
    const { detail, versionDir } = await options
      .publisher()
      .exportable({ artifact: { artifactId }, version: versionId });
    const exporter = (
      await options.plugins().exporters({
        artifactId: detail.id,
        versionDir,
        ...(detail.source !== undefined ? { sourceDir: detail.source } : {}),
      })
    ).find((candidate) => candidate.id === MCP_APP_EXPORTER);
    if (exporter === undefined) {
      throw new RpcError(
        createDiagnostic("MOSTRA_PLUGIN_EXPORTER_UNKNOWN", {
          message: `No plugin of this version or of the home contributes the exporter "${MCP_APP_EXPORTER}", and this runtime carries none.`,
        }),
      );
    }
    const pkg = JSON.parse(await readFile(join(exporter.dir, "package.json"), "utf8")) as {
      version?: string;
    };
    const key = createHash("sha256")
      .update(`${exporter.package}\0${pkg.version ?? ""}\0${exporter.file}`)
      .digest("hex")
      .slice(0, 16);
    const dir = join(options.cacheDir, versionId, key);
    const read = async (): Promise<AppPageResult> => {
      const description = JSON.parse(await readFile(join(dir, "mcp-app.json"), "utf8")) as {
        uri?: unknown;
        _meta?: { ui?: McpAppResourceMeta };
      };
      return {
        artifactId,
        uri: typeof description.uri === "string" ? description.uri : mcpAppUri(versionId),
        html: await readFile(join(dir, "index.html"), "utf8"),
        meta: description._meta?.ui ?? {},
      };
    };
    if (existsSync(join(dir, "mcp-app.json"))) return read();
    const running = exporting.get(dir);
    if (running) return running;
    const task = (async () => {
      const scratch = `${dir}.${randomBytes(6).toString("hex")}.out`;
      try {
        const done = await exportVersion({
          artifact: { artifactId },
          version: versionId,
          exporter: MCP_APP_EXPORTER,
          out: scratch,
        });
        const failed = done.findings.find((finding) => finding.severity === "error");
        if (failed !== undefined) {
          throw new RpcError(
            createDiagnostic("MOSTRA_PLUGIN_FAILED", {
              message: `The MCP App of version ${versionId} couldn't be made: ${failed.message}`,
            }),
          );
        }
        if (
          !existsSync(join(scratch, "index.html")) ||
          !existsSync(join(scratch, "mcp-app.json"))
        ) {
          throw new RpcError(
            createDiagnostic("MOSTRA_PLUGIN_FAILED", {
              message: `The exporter ${exporter.id} (${exporter.package}) wrote no index.html and mcp-app.json.`,
            }),
          );
        }
        await mkdir(dirname(dir), { recursive: true });
        // Another process may have kept one meanwhile: theirs is the same version's same page.
        if (!existsSync(dir)) await renamePath(scratch, dir).catch(() => undefined);
        return await read();
      } finally {
        await removeTree(scratch).catch(() => undefined);
        exporting.delete(dir);
      }
    })();
    exporting.set(dir, task);
    return task;
  };

  return [
    handler(pluginValidateMethod, (params) =>
      options.plugins().validate(params.path, params.acceptLicenses ?? []),
    ),

    handler(pluginAddMethod, async (params) => {
      const result = await inScope(params, (scope) =>
        options.plugins().add(scope, {
          packages: params.packages,
          accept: params.acceptLicenses ?? [],
          request: requestKey("plugin/add", params),
        }),
      );
      if (params.artifact !== undefined) options.dependenciesChanged?.(params.artifact);
      return result;
    }),

    handler(pluginListMethod, (params) =>
      inScope(params, (scope) => options.plugins().list(scope)),
    ),

    handler(pluginRemoveMethod, async (params) => {
      const result = await inScope(params, (scope) =>
        options.plugins().remove(scope, {
          packages: params.packages,
          request: requestKey("plugin/remove", params),
        }),
      );
      if (params.artifact !== undefined) options.dependenciesChanged?.(params.artifact);
      return result;
    }),

    handler(pluginCommandsMethod, async (params) => {
      if (params.artifact === undefined)
        return { commands: await options.plugins().commands(undefined) };
      return options
        .publisher()
        .withArtifact(params.artifact, async ({ target }) => ({
          commands: await options.plugins().commands(target),
        }))
        .catch(async (error: unknown) => {
          // A directory that isn't an artifact (the CLI asks from wherever it runs) has the
          // home's commands only.
          if (error instanceof RpcError && error.diagnostic.code.startsWith("MOSTRA_ARTIFACT_")) {
            return { commands: await options.plugins().commands(undefined) };
          }
          throw error;
        });
    }),

    handler(pluginExportMethod, (params) => exportVersion(params)),
    handler(appPageMethod, (params) => appPage(params.versionId)),
  ];
}
