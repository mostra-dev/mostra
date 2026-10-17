/**
 * `verify` (D29, D41, D55, D72, D137; ARCHITECTURE §12, INTERFACES §13): one run over a prepared
 * source, giving one verdict. The stages, in order:
 *
 * 1. **compile**: the build (into `cache/builds/<versionId>/`, which publish promotes) and the type
 *    check beside it, inside the build's 180 s. A source that didn't build stops here.
 * 2. **lint**: the static field-ID scan.
 * 3. **boot**: a sandbox (`sandbox.ts`) serving the build and the last passing version.
 * 4. **render**: each viewport of the baseline, then of the source, in the warm browser; a second
 *    boot for changing field IDs; the smoke test. 120 s cover stages 3 to 5 (FAILURE_MODEL §9).
 * 5. **regression**: contracts, ARIA and pixels against the baseline.
 *
 * The verdict is cached by source digest, environment digest and {@link VERIFY_REVISION}, unless an
 * error says the run couldn't vouch for the page (the environment, a timeout, a crash): publish
 * reuses it for the same digests (D41).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type ArtifactManifest,
  ariaSummary,
  createDiagnostic,
  type Diagnostic,
  estimateImageTokens,
  type ProbedField,
  type RenderRequest,
  type RenderResult,
  RpcError,
  type ScreenshotPolicy,
  type VerdictAria,
  type VerdictScreenshot,
  VerifyVerdict,
  type VerifyViewport,
  viewportsFor,
} from "@mostra/protocol";
import type { VersionRegistry } from "../builder/index.ts";
import type { Ledger } from "../ledger/index.ts";
import type { Log, Redactor } from "../log.ts";
import type { Registry } from "../registry/index.ts";
import { probedFieldLint, staticFieldLint, unstableFieldLint } from "./fields.ts";
import { ariaRegression, contractRegressions, pixelRegression } from "./regression.ts";
import type { RunnerClient } from "./runner.ts";
import { type Sandbox, type SandboxOptions, type SandboxVersion, startSandbox } from "./sandbox.ts";
import { TYPECHECK_REVISION, typecheck } from "./typecheck.ts";

export { createRunnerClient, locateRunner, type RunnerClient } from "./runner.ts";
export { recoverSandboxes, type SandboxOptions } from "./sandbox.ts";

/** The revision of verify's rules: a cached verdict made under other rules is never reused. */
export const VERIFY_REVISION: string = createHash("sha256")
  .update(`verify 1 ${TYPECHECK_REVISION}`)
  .digest("hex")
  .slice(0, 16);

/** How long the stages after compile may take (FAILURE_MODEL §9, D137 item 6). */
export const VERIFY_TIMEOUT_MS = 120_000;
/** The smoke test's budget (ROUND-3 §9). */
export const SMOKE_BUDGET = { maxInteractions: 200, maxMs: 60_000 } as const;
/** The build cache's cap (D47): least recently used builds go first. */
const BUILD_CACHE_BYTES = 5 * 1024 ** 3;
/** How many verdicts the cache keeps. */
const VERDICT_CACHE_ENTRIES = 200;

/** Codes that say a run couldn't vouch for the page: its verdict is never cached (D137 item 5). */
const UNCACHEABLE =
  /^MOSTRA_(ENV|VERIFY_TIMEOUT|VERIFY_CRASHED|BUILD_TIMEOUT|BUILD_CRASHED|DEP_OFFLINE|DEP_TIMEOUT)/;

/** A source prepared for verify or publish: snapshot, manifest, dependencies and digests. */
export interface PreparedSource {
  /** The source path as the caller named it. */
  readonly path: string;
  /** The staging directory; the snapshot is in its `source/`. */
  readonly stagingDir: string;
  /** The artifact's source directory, where server code runs. */
  readonly sourceDir: string;
  readonly manifest: ArtifactManifest;
  /** The manifest's warnings (unknown keys). */
  readonly warnings: readonly Diagnostic[];
  /** The artifact: known (a manifest `id` or a binding) or provisional. */
  readonly artifactId: string;
  readonly identityKnown: boolean;
  readonly sourceDigest: string;
  readonly envDigest: string;
  readonly versionId: string;
  /** The `node_modules` the build links (D95). */
  readonly nodeModules: string;
}

/** A finished build in a directory, as publish lays out a version. */
export type BuildOutcome =
  | { readonly ok: true; readonly outputDigest: string; readonly registry: VersionRegistry }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

/** Options for {@link createVerifier}. */
export interface VerifierOptions {
  readonly home: string;
  readonly ledger: Ledger;
  readonly registry: Registry;
  readonly log: Log;
  readonly redactor: Redactor;
  readonly runner: RunnerClient;
  readonly sandbox: SandboxOptions;
  /** Clears the artifact's parked worker in the instance's pool (D133). */
  readonly clearPark: (artifactId: string) => void;
  /** Tests shorten the 120 s and the smoke test's 200 interactions. */
  readonly limits?: { readonly timeoutMs?: number; readonly smokeInteractions?: number };
}

/** One run's options. */
export interface VerifyRun {
  /** Builds the prepared source into `outDir`, laid out as a version (manifest, registry, lock). */
  readonly build: (outDir: string) => Promise<BuildOutcome>;
  readonly screenshots?: ScreenshotPolicy;
  /** Told as each stage starts. */
  readonly progress?: (stage: string) => void;
}

/** The verifier of one instance. */
export interface Verifier {
  /** Runs verify; replaces the cached verdict for the same digests. */
  run(prepared: PreparedSource, run: VerifyRun): Promise<VerifyVerdict>;
  /** The cached verdict for these digests, if one was made for this artifact (or none named). */
  cached(prepared: PreparedSource): VerifyVerdict | undefined;
  /** Verify's build of a version, when the cache still holds it complete. */
  builtVersion(versionId: string): string | undefined;
  /** Whether a verdict's errors stop a publish, and which codes it records with `--force`. */
  readonly cacheDir: string;
}

/** The source's page never got ready: the browser stages after its first render can't run. */
class NotReady extends Error {}

/** The verdict cache's key for two digests. */
export function verdictKey(sourceDigest: string, envDigest: string): string {
  return createHash("sha256")
    .update(`${sourceDigest}\u0000${envDigest}\u0000${VERIFY_REVISION}`)
    .digest("hex");
}

const sum = (diagnostics: readonly Diagnostic[]): boolean =>
  diagnostics.some((diagnostic) => diagnostic.severity === "error");

/** The directory size, for the build cache's cap. */
async function sizeOf(dir: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) total += await sizeOf(path);
    else total += (await stat(path).catch(() => ({ size: 0 }))).size;
  }
  return total;
}

/** Creates the verifier. */
export function createVerifier(options: VerifierOptions): Verifier {
  const { home, log, registry } = options;
  const buildsDir = join(home, "cache", "builds");
  const cacheDir = join(home, "cache", "verify");
  const completeBuild = (versionId: string): string | undefined => {
    const dir = join(buildsDir, versionId);
    return existsSync(join(dir, "manifest.json")) ? dir : undefined;
  };

  /** Keeps the build cache under its cap, oldest first, never `keep`. */
  const pruneBuilds = async (keep: string): Promise<void> => {
    const entries = await readdir(buildsDir, { withFileTypes: true }).catch(() => []);
    const builds = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !entry.name.includes(".tmp-"))
        .map(async (entry) => {
          const dir = join(buildsDir, entry.name);
          return {
            dir,
            name: entry.name,
            mtime: (await stat(dir)).mtimeMs,
            size: await sizeOf(dir),
          };
        }),
    );
    let total = builds.reduce((acc, build) => acc + build.size, 0);
    for (const build of builds.sort((a, b) => a.mtime - b.mtime)) {
      if (total <= BUILD_CACHE_BYTES) break;
      if (build.name === keep) continue;
      await rm(build.dir, { recursive: true, force: true });
      total -= build.size;
    }
  };

  /** Keeps the newest verdicts. */
  const pruneVerdicts = async (): Promise<void> => {
    const names = (await readdir(cacheDir).catch(() => [])).filter((name) =>
      name.endsWith(".json"),
    );
    if (names.length <= VERDICT_CACHE_ENTRIES) return;
    const dated = await Promise.all(
      names.map(async (name) => ({ name, mtime: (await stat(join(cacheDir, name))).mtimeMs })),
    );
    for (const { name } of dated
      .sort((a, b) => a.mtime - b.mtime)
      .slice(0, names.length - VERDICT_CACHE_ENTRIES)) {
      await rm(join(cacheDir, name), { force: true });
      await rm(join(cacheDir, name.slice(0, -".json".length)), { recursive: true, force: true });
    }
  };

  /** The newest version of the artifact whose recorded verdict passed (D137 item 4). */
  const baselineOf = (
    artifactId: string,
  ):
    | { readonly versionId: string; readonly dir: string }
    | { readonly missing: string }
    | undefined => {
    const passed = registry.passedVersion(artifactId);
    if (passed === undefined) return undefined;
    const dir = registry.store.versionDir(passed);
    return existsSync(join(dir, "manifest.json")) && existsSync(join(dir, "registry.json"))
      ? { versionId: passed, dir }
      : { missing: passed };
  };

  /** The answers the home holds under a field ID of an artifact (orphans to be, D42). */
  const savedAnswers = (artifactId: string, fieldId: string): number =>
    options.ledger.read(
      (db) =>
        db.get<{ count: number }>(
          "SELECT COUNT(*) AS count FROM field JOIN document ON document.id = field.document_id WHERE document.artifact_id = ? AND field.field_id = ? AND field.deleted = 0",
          artifactId,
          fieldId,
        )?.count ?? 0,
    );

  const readRegistry = (dir: string): VersionRegistry =>
    JSON.parse(readFileSync(join(dir, "registry.json"), "utf8")) as VersionRegistry;

  const sandboxVersion = (versionId: string, dir: string): SandboxVersion => {
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as {
      manifest: ArtifactManifest;
      sourceDigest: string;
      envDigest: string;
      outputDigest: string;
    };
    return {
      versionId,
      dir,
      manifest: manifest.manifest,
      sourceDigest: manifest.sourceDigest,
      envDigest: manifest.envDigest,
      outputDigest: manifest.outputDigest,
    };
  };

  /** Builds the source into the build cache (atomically), or reuses a complete build. */
  const buildInto = async (prepared: PreparedSource, run: VerifyRun): Promise<BuildOutcome> => {
    const existing = completeBuild(prepared.versionId);
    if (existing && (await options.sandbox.damage(existing)) === undefined) {
      return {
        ok: true,
        outputDigest: (
          JSON.parse(readFileSync(join(existing, "manifest.json"), "utf8")) as {
            outputDigest: string;
          }
        ).outputDigest,
        registry: readRegistry(existing),
      };
    }
    await mkdir(buildsDir, { recursive: true, mode: 0o700 });
    const temporary = join(buildsDir, `${prepared.versionId}.tmp-${process.pid}-${Date.now()}`);
    try {
      const outcome = await run.build(temporary);
      if (!outcome.ok) return outcome;
      await rm(join(buildsDir, prepared.versionId), { recursive: true, force: true });
      await rename(temporary, join(buildsDir, prepared.versionId));
      await pruneBuilds(prepared.versionId);
      return outcome;
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  };

  const verify = async (prepared: PreparedSource, run: VerifyRun): Promise<VerifyVerdict> => {
    const started = Date.now();
    const timings: Record<string, number> = {};
    const time = (stage: string, since: number): void => {
      timings[stage] = Date.now() - since;
    };
    const diagnostics: Diagnostic[] = [...prepared.warnings];
    const key = verdictKey(prepared.sourceDigest, prepared.envDigest);
    const artifactsDir = join(cacheDir, key);
    await rm(artifactsDir, { recursive: true, force: true });
    await mkdir(artifactsDir, { recursive: true, mode: 0o700 });
    const { viewports, unknown } = viewportsFor(prepared.manifest.verify?.viewports);
    if (unknown.length > 0) log.warn("verify.unknown_viewports", { unknown });

    // 1. Compile: the build and the type check beside it.
    run.progress?.("compile");
    const compileStart = Date.now();
    const hasLive = existsSync(join(prepared.stagingDir, "source", "live.ts"));
    let buildDiagnostics: readonly Diagnostic[] = [];
    const [built, checked] = await Promise.all([
      buildInto(prepared, run).then((outcome) => {
        time("build", compileStart);
        if (!outcome.ok) buildDiagnostics = outcome.diagnostics;
        return outcome;
      }),
      typecheck({
        processes: options.sandbox.processes,
        log,
        env: options.sandbox.env,
        sourceDir: join(prepared.stagingDir, "source"),
        workDir: `${prepared.stagingDir}-check`,
        nodeModules: prepared.nodeModules,
        hasLive,
        alreadyReported: (specifier) =>
          buildDiagnostics.some((diagnostic) => diagnostic.message.includes(specifier)),
      }).then((outcome) => {
        time("typecheck", compileStart);
        return outcome;
      }),
    ]);
    diagnostics.push(...(built.ok ? [] : built.diagnostics));
    diagnostics.push(
      ...checked.diagnostics.filter(
        (diagnostic) =>
          built.ok ||
          diagnostic.code !== "MOSTRA_TYPE_ERROR" ||
          !/TS2307/.test(diagnostic.message) ||
          !built.diagnostics.some((other) =>
            diagnostic.message.includes(other.message.slice(0, 40)),
          ),
      ),
    );

    const regressions: {
      against?: string;
      aria?: string;
      pixels?: { viewport: string; ratio: number }[];
      contracts?: string[];
    } = {};
    const screenshots: VerdictScreenshot[] = [];
    const aria: VerdictAria[] = [];
    const smoke = { interactions: 0, skippedActions: [] as string[], stateChanges: 0 };

    if (built.ok) {
      // 2. Lint: the static field-ID scan.
      const lintStart = Date.now();
      const coverage = built.registry.fields;
      diagnostics.push(...staticFieldLint(coverage));
      time("lint", lintStart);

      const baseline = prepared.identityKnown ? baselineOf(prepared.artifactId) : undefined;
      if (!baseline) {
        diagnostics.push(
          createDiagnostic("MOSTRA_VERIFY_NO_BASELINE", {
            message: "No earlier version of this artifact passed verify, so nothing was compared.",
          }),
        );
      } else if ("missing" in baseline) {
        diagnostics.push(
          createDiagnostic("MOSTRA_VERIFY_BASELINE_MISSING", {
            message: `The last passing version's build (${baseline.missing}) isn't in the home any more, so nothing was compared.`,
          }),
        );
      }
      const compared =
        baseline && !("missing" in baseline) && baseline.versionId !== prepared.versionId
          ? baseline
          : undefined;
      if (baseline && !("missing" in baseline)) regressions.against = baseline.versionId;
      if (prepared.identityKnown) options.clearPark(prepared.artifactId);

      // 3 to 5: boot, render, smoke and regressions, within 120 s.
      const deadline = Date.now() + (options.limits?.timeoutMs ?? VERIFY_TIMEOUT_MS);
      const candidateDir = join(buildsDir, prepared.versionId);
      let sandbox: Sandbox | undefined;
      let stage = "boot";
      try {
        run.progress?.("boot");
        const bootStart = Date.now();
        sandbox = await startSandbox(options.sandbox, {
          artifactId: prepared.artifactId,
          versions: [
            ...(compared ? [sandboxVersion(compared.versionId, compared.dir)] : []),
            sandboxVersion(prepared.versionId, candidateDir),
          ],
          sourceDir: prepared.sourceDir,
        });
        const health = await fetch(`${sandbox.shellOrigin}/a/${prepared.artifactId}`).catch(
          () => undefined,
        );
        if (!health?.ok) throw new Error("The verify sandbox's shell didn't answer.");
        time("boot", bootStart);

        const clockMs = Math.floor(started / 1000) * 1000;
        const render = async (
          versionId: string,
          viewport: VerifyViewport,
          name: string,
          collect: RenderRequest["collect"],
        ): Promise<RenderResult> => {
          const result = await options.runner.render({
            url: (sandbox as Sandbox).link(versionId),
            viewport,
            clockMs,
            outDir: artifactsDir,
            name,
            collect,
            deadline,
          });
          if (result.timedOut) {
            throw new RpcError(
              createDiagnostic("MOSTRA_VERIFY_TIMEOUT", {
                message: `Verify ran out of its ${Math.round((options.limits?.timeoutMs ?? VERIFY_TIMEOUT_MS) / 1000)} s during the ${stage} stage (${name}).`,
              }),
            );
          }
          return result;
        };

        stage = "render";
        run.progress?.("render");
        const renderStart = Date.now();
        const candidateShots = new Map<string, RenderResult>();
        const renderCandidate = async (
          index: number,
          viewport: VerifyViewport,
        ): Promise<RenderResult> => {
          const result = await render(prepared.versionId, viewport, viewport.name, {
            screenshot: true,
            aria: true,
            axe: true,
            fields: index === 0,
          });
          candidateShots.set(viewport.name, result);
          diagnostics.push(...result.findings);
          if (result.screenshot) {
            screenshots.push({
              viewport: viewport.name,
              path: result.screenshot.path,
              width: result.screenshot.width,
              height: result.screenshot.height,
              tokensEstimate: estimateImageTokens(
                result.screenshot.width,
                result.screenshot.height,
              ),
              returned: false,
            });
          }
          if (result.aria) {
            const text = options.redactor.redact(result.aria.text);
            await writeFile(result.aria.path, text);
            aria.push({
              viewport: viewport.name,
              path: result.aria.path,
              summary: ariaSummary(text),
            });
          }
          return result;
        };
        // The source's first viewport first: a page that never gets ready ends the browser stages
        // here, rather than waiting the same way at every other render.
        const opening = await renderCandidate(0, viewports[0] as VerifyViewport);
        const baselineShots = new Map<string, RenderResult>();
        if (opening.ready) {
          if (compared) {
            stage = "baseline render";
            for (const viewport of viewports) {
              baselineShots.set(
                viewport.name,
                await render(compared.versionId, viewport, `baseline-${viewport.name}`, {
                  screenshot: true,
                  aria: true,
                  axe: false,
                  fields: false,
                }),
              );
            }
          }
          stage = "render";
          for (const [index, viewport] of viewports.entries()) {
            if (index > 0) await renderCandidate(index, viewport);
          }
        }
        time("render", renderStart);

        if (!opening.ready) throw new NotReady();
        // The second boot with identical inputs, for field IDs that change between renders.
        const first = viewports[0] as VerifyViewport;
        const firstFields: readonly ProbedField[] = candidateShots.get(first.name)?.fields ?? [];
        diagnostics.push(...probedFieldLint(firstFields, first.name));
        stage = "field stability";
        const again = await render(prepared.versionId, first, `${first.name}-again`, {
          screenshot: false,
          aria: false,
          axe: false,
          fields: true,
        });
        diagnostics.push(
          ...unstableFieldLint(firstFields, again.fields ?? [], coverage, first.name),
        );

        if (prepared.manifest.verify?.smoke !== false) {
          stage = "smoke";
          run.progress?.("smoke");
          const smokeStart = Date.now();
          const result = await render(prepared.versionId, first, `${first.name}-smoke`, {
            screenshot: false,
            aria: false,
            axe: false,
            fields: false,
            smoke: {
              ...SMOKE_BUDGET,
              ...(options.limits?.smokeInteractions !== undefined
                ? { maxInteractions: options.limits.smokeInteractions }
                : {}),
            },
          });
          diagnostics.push(...result.findings);
          smoke.interactions = result.smoke?.interactions ?? 0;
          smoke.stateChanges = result.smoke?.stateChanges ?? 0;
          time("smoke", smokeStart);
        }

        stage = "regression";
        run.progress?.("regression");
        const regressionStart = Date.now();
        if (compared) {
          const contracts = contractRegressions(
            readRegistry(compared.dir),
            built.registry,
            (fieldId) => savedAnswers(prepared.artifactId, fieldId),
          );
          diagnostics.push(...contracts.diagnostics);
          if (contracts.summary.length > 0) regressions.contracts = contracts.summary;
          const ariaSummaries: string[] = [];
          const pixels: { viewport: string; ratio: number }[] = [];
          for (const viewport of viewports) {
            const before = baselineShots.get(viewport.name);
            const after = candidateShots.get(viewport.name);
            if (!before || !after) continue;
            if (before.aria && after.aria) {
              const found = ariaRegression(before.aria.text, after.aria.text, viewport.name);
              if (found) {
                diagnostics.push(found.diagnostic);
                ariaSummaries.push(found.summary);
              }
            }
            if (before.screenshot && after.screenshot) {
              const diff = join(artifactsDir, `diff-${viewport.name}.png`);
              const compared = await options.runner.compare({
                a: before.screenshot.path,
                b: after.screenshot.path,
                diff,
              });
              pixels.push({ viewport: viewport.name, ratio: compared.ratio });
              const found = pixelRegression(
                compared.ratio,
                compared.sizeChanged,
                viewport.name,
                diff,
              );
              if (found) diagnostics.push(found);
            }
          }
          if (ariaSummaries.length > 0) regressions.aria = ariaSummaries.join("; ");
          if (pixels.length > 0) regressions.pixels = pixels;
        }
        time("regression", regressionStart);

        for (const failure of sandbox.liveFailures()) {
          diagnostics.push(
            createDiagnostic(
              failure.code === "MOSTRA_SECRET_MISSING"
                ? "MOSTRA_VERIFY_SECRET_MISSING"
                : "MOSTRA_VERIFY_LIVE_FAILED",
              {
                message: `The live source ${failure.key} failed while verify rendered the page: ${failure.message}`,
              },
            ),
          );
        }
      } catch (error) {
        if (error instanceof NotReady) {
          // Reported by the render already; nothing after it can run.
        } else if (error instanceof RpcError) diagnostics.push(error.diagnostic);
        else {
          log.error("verify.stage_failed", { stage, error });
          diagnostics.push(
            createDiagnostic("MOSTRA_VERIFY_CRASHED", {
              message: `Verify stopped during the ${stage} stage: ${(error as Error).message ?? String(error)}`,
            }),
          );
        }
      } finally {
        if (sandbox) {
          for (const fn of sandbox.skipped) {
            smoke.skippedActions.push(fn);
            diagnostics.push(
              createDiagnostic("MOSTRA_VERIFY_ACTION_SKIPPED", {
                message: `Verify didn't run the server function ${fn}: it doesn't check dryRun().`,
              }),
            );
          }
          await sandbox.close();
        }
      }
    }

    timings["total"] = Date.now() - started;
    const merged = mergeDiagnostics(diagnostics).map((diagnostic) => ({
      ...diagnostic,
      message: options.redactor.redact(diagnostic.message),
    }));
    const failed = sum(merged);
    const policy = run.screenshots ?? "on-failure";
    const verdict: VerifyVerdict = {
      status: failed ? "fail" : "pass",
      artifact: {
        ...(prepared.identityKnown
          ? { id: prepared.artifactId, versionId: prepared.versionId }
          : {}),
        path: prepared.path,
        sourceDigest: prepared.sourceDigest,
        envDigest: prepared.envDigest,
      },
      diagnostics: merged,
      screenshots: screenshots.map((shot) => ({
        ...shot,
        returned: policy === "always" || (policy === "on-failure" && failed),
      })),
      aria,
      smoke,
      regressions,
      timingsMs: timings,
    };
    const checkedVerdict = VerifyVerdict.parse(verdict);
    if (
      !merged.some(
        (diagnostic) => diagnostic.severity === "error" && UNCACHEABLE.test(diagnostic.code),
      )
    ) {
      await mkdir(cacheDir, { recursive: true, mode: 0o700 });
      const target = join(cacheDir, `${key}.json`);
      await writeFile(`${target}.tmp`, `${JSON.stringify(checkedVerdict, null, 2)}\n`);
      await rename(`${target}.tmp`, target);
      await pruneVerdicts();
    } else {
      await rm(join(cacheDir, `${key}.json`), { force: true });
    }
    log.info("verify.finished", {
      status: verdict.status,
      errors: merged
        .filter((diagnostic) => diagnostic.severity === "error")
        .map((diagnostic) => diagnostic.code),
      totalMs: timings["total"],
    });
    return checkedVerdict;
  };

  return {
    cacheDir,
    run: verify,
    cached(prepared) {
      const file = join(cacheDir, `${verdictKey(prepared.sourceDigest, prepared.envDigest)}.json`);
      let raw: unknown;
      try {
        raw = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        return undefined;
      }
      const parsed = VerifyVerdict.safeParse(raw);
      if (!parsed.success) return undefined;
      const id = parsed.data.artifact.id;
      // A verdict made for another artifact (a copy with the same files) isn't this one's.
      if (id !== undefined && prepared.identityKnown && id !== prepared.artifactId)
        return undefined;
      return parsed.data;
    },
    builtVersion: completeBuild,
  };
}

/**
 * Folds identical diagnostics (same code and message) into one. Several renders of one page report
 * the same fault once each, so the fold keeps the largest count rather than adding them.
 */
function mergeDiagnostics(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  const seen = new Map<string, Diagnostic>();
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.code}\u0000${diagnostic.message}`;
    const known = seen.get(key);
    if (known) {
      const count = Math.max(known.count ?? 1, diagnostic.count ?? 1);
      seen.set(key, count > 1 ? { ...known, count } : known);
    } else seen.set(key, diagnostic);
  }
  const order = { error: 0, warning: 1, hint: 2 };
  return [...seen.values()].sort((a, b) => order[a.severity] - order[b.severity]);
}

/** The error codes of a verdict, each once, in order: what `--force` records (D41). */
export function errorCodes(verdict: VerifyVerdict): string[] {
  return [
    ...new Set(
      verdict.diagnostics
        .filter((diagnostic) => diagnostic.severity === "error")
        .map((diagnostic) => diagnostic.code),
    ),
  ];
}

/** Whether a verdict says the source didn't build, which `--force` can't publish (D137 item 7). */
export function didNotBuild(verdict: VerifyVerdict): Diagnostic | undefined {
  return verdict.diagnostics.find(
    (diagnostic) =>
      diagnostic.severity === "error" &&
      (diagnostic.code.startsWith("MOSTRA_BUILD_") ||
        diagnostic.code.startsWith("MOSTRA_DEP_") ||
        diagnostic.code.startsWith("MOSTRA_ARTIFACT_")),
  );
}
