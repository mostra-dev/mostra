/**
 * The plugin system's methods of the host protocol (INTERFACES §14): `plugin/validate`,
 * `plugin/add`, `plugin/list`, `plugin/remove`, `plugin/export` and `plugin/commands`
 * (`pack/add` is the packs module's). Each that names an artifact runs in its source path's queue, as its publishes and
 * `deps/add` do, through the publisher; the home's own plugins have one queue of their own (the
 * working lockfile `home:plugins`).
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import {
  checkArtifactPath,
  createDiagnostic,
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
import { handler, type MethodHandler } from "../protocol-server/index.ts";
import { canonicalRef, type Publisher } from "../publish/index.ts";
import type { Plugins, Scope } from "./plugins.ts";

const usage = (message: string): RpcError =>
  new RpcError(createDiagnostic("MOSTRA_PLUGIN_SCOPE_INVALID", { message }));

/** The handlers of the plugin system's methods. */
export function pluginMethods(options: {
  readonly plugins: () => Plugins;
  readonly publisher: () => Publisher;
  readonly log: Log;
  /** An artifact's dependencies changed (a dev session reloads, D140 item 12). */
  readonly dependenciesChanged?: (artifact: SourceRef) => void;
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

  return [
    handler(pluginValidateMethod, (params) => options.plugins().validate(params.path)),

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

    handler(pluginExportMethod, async (params) => {
      const { detail, summary, versionDir } = await options
        .publisher()
        .exportable({ ...params, artifact: canonicalRef(params.artifact) });
      const target = {
        key: detail.id,
        artifactDir: detail.source ?? versionDir,
        artifactPath: detail.source ?? detail.id,
      };
      const exporters = await options.plugins().exporters(target);
      const exporter = exporters.find((candidate) => candidate.id === params.exporter);
      if (exporter === undefined) {
        throw new RpcError(
          createDiagnostic("MOSTRA_PLUGIN_EXPORTER_UNKNOWN", {
            message: `No plugin of ${detail.title} or of the home contributes the exporter "${params.exporter}"; the exporters available are bundle${exporters.map((candidate) => `, ${candidate.id}`).join("")}.`,
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
      if (existsSync(params.out)) {
        const info = await stat(params.out);
        if (!info.isDirectory() || (await readdir(params.out)).length > 0) {
          throw new RpcError(
            createDiagnostic("MOSTRA_ARTIFACT_DIR_NOT_EMPTY", {
              message: `${params.out} already exists and isn't an empty directory.`,
            }),
          );
        }
      }
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
        },
        options: params.options ?? {},
      });
      // Every file stays inside `out`, with a name every system holds; nothing is written until
      // all of them are checked.
      const planned: { path: string; data: Buffer | string }[] = [];
      const seen = new Set<string>();
      for (const file of answer.files) {
        const check = checkArtifactPath(file.path);
        if (!check.ok || seen.has(check.path.toLowerCase())) {
          throw new RpcError(
            createDiagnostic("MOSTRA_PLUGIN_FAILED", {
              message: `The exporter ${exporter.id} (${exporter.package}) returned the file "${file.path.slice(0, 200)}", ${!check.ok ? "which isn't a path inside its output" : "twice"}. Nothing was written.`,
            }),
          );
        }
        seen.add(check.path.toLowerCase());
        planned.push({
          path: check.path,
          data: "text" in file ? file.text : Buffer.from(file.base64, "base64"),
        });
      }
      const written: string[] = [];
      for (const file of planned) {
        const path = join(params.out, ...file.path.split("/"));
        await mkdir(resolve(path, ".."), { recursive: true });
        await writeFile(path, file.data);
        written.push(path);
      }
      options.log.info("plugins.exported", {
        artifactId: detail.id,
        versionId: summary.id,
        exporter: exporter.id,
        files: written.length,
      });
      const findings: PluginFinding[] = answer.findings.flatMap((value) => {
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
      return {
        files: written,
        ...(answer.entry !== undefined && seen.has(answer.entry.toLowerCase())
          ? { entry: join(params.out, ...answer.entry.split("/")) }
          : {}),
        versionId: summary.id,
        exporter: { id: exporter.id, package: exporter.package },
        findings,
      };
    }),
  ];
}
