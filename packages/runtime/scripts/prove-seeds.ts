/**
 * Seeded-violation proofs for the runtime's owned requirements (README §3 of the work-package
 * protocol): each seed breaks the product in one place, rebuilds, runs the check that must catch
 * it (red), restores the file and runs the check again (green). Run from the repository root:
 *
 *   node packages/runtime/scripts/prove-seeds.ts [--only RT-09]
 *
 * It edits source files in place and restores them in `finally`, also on Ctrl-C. Don't run it
 * with uncommitted edits to the seeded files.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, stripVTControlCharacters } from "node:util";

interface Seed {
  readonly requirement: string;
  readonly name: string;
  /** Relative to packages/runtime. */
  readonly file: string;
  readonly from: string;
  readonly to: string;
  /** Further edits planted with the first, for a violation that must defeat more than one guard. */
  readonly also?: readonly { readonly file: string; readonly from: string; readonly to: string }[];
  /** Vitest arguments, run in packages/runtime. */
  readonly check: readonly string[];
  /** Playwright Test arguments instead, run in tests/e2e (three engines unless narrowed). */
  readonly e2e?: boolean;
  /** Where Vitest runs, relative to packages/runtime, when not there. */
  readonly cwd?: string;
}

const integration = (file: string, ...filter: string[]): string[] => [
  "--project",
  "integration",
  `test/integration/${file}`,
  ...(filter.length > 0 ? ["-t", ...filter] : []),
];

const hygiene = (...filter: string[]): string[] => [
  "--project",
  "hygiene",
  ...(filter.length > 0 ? ["-t", ...filter] : []),
];
const unit = (file: string, ...filter: string[]): string[] => [
  "--project",
  "unit",
  `test/unit/${file}`,
  ...(filter.length > 0 ? ["-t", ...filter] : []),
];
const e2e = (...grep: string[]): string[] => (grep.length > 0 ? ["-g", grep.join("|")] : []);

const SEEDS: readonly Seed[] = [
  // The Claude Opus review of WP-05 (M17): each fix, undone.
  {
    requirement: "wp05-claude-1",
    name: "one guessing count for the whole gateway, so one artifact locks out every other",
    file: "src/gateway/capabilities.ts",
    from: '    const key = known ? artifactId : "";',
    to: '    const key = "";',
    also: [
      {
        file: "src/gateway/capabilities.ts",
        from: "    const failures = this.#failures.get(artifactId);",
        to: '    const failures = this.#failures.get("");',
      },
    ],
    check: unit("gateway.test.ts", "valid ones too"),
  },
  {
    requirement: "wp05-claude-2",
    name: "a link that names a version opens any version",
    file: "src/gateway/index.ts",
    from: "    if (pinned !== undefined && asked !== undefined && asked !== pinned) {",
    to: "    if (false) {",
    also: [
      {
        file: "src/gateway/index.ts",
        from: '      if (!file && path.startsWith("/assets/") && session.grant.pinnedVersion === undefined) {',
        to: '      if (!file && path.startsWith("/assets/")) {',
      },
    ],
    check: integration("gateway.test.ts", "opens only the version a link names"),
  },
  {
    requirement: "wp05-claude-3",
    name: "a cookie jar any artifact can fill breaks every link (32 KiB of headers)",
    file: "src/gateway/listener.ts",
    from: "export const MAX_HEADER_SIZE: number = 1024 * 1024;",
    to: "export const MAX_HEADER_SIZE: number = 32 * 1024;",
    check: e2e("filling the host's cookie jar"),
    e2e: true,
  },
  {
    requirement: "wp05-claude-4",
    name: "the frame is not sandboxed and can replace the shell",
    file: "../shell/src/shell.tsx",
    from: "      sandbox={frameSandbox()}",
    to: "",
    check: e2e("neither itself nor through a popup"),
    e2e: true,
  },
  {
    requirement: "wp05-claude-4",
    name: "the shell sends no Cross-Origin-Opener-Policy, so a popup navigates it in Firefox",
    file: "src/gateway/http.ts",
    from: '      "cross-origin-opener-policy": "same-origin",',
    to: "",
    check: [...e2e("neither itself nor through a popup"), "--project", "firefox"],
    e2e: true,
  },
  {
    requirement: "wp05-claude-5",
    name: "a version's files are checked once and never again",
    file: "src/gateway/integrity.ts",
    from: "      if (verified.get(versionId)?.get(file.path) === file.ctimeMs) return undefined;",
    to: "      if (verified.has(versionId)) return undefined;",
    check: integration("gateway.test.ts", "is never shown"),
  },
  {
    requirement: "wp05-claude-6",
    name: "another link silently replaces a live session",
    file: "src/gateway/index.ts",
    from: '      if (body["replace"] !== true) {',
    to: "      if (false) {",
    check: hygiene("asks before another link replaces"),
  },
  {
    requirement: "wp05-claude-7",
    name: "the guessing limit is checked only before the body is read",
    file: "src/gateway/capabilities.ts",
    from: "    const limited = this.limited(artifactId);\n    if (limited) return limited;\n",
    to: "",
    check: hygiene("concurrent guesses"),
  },
  {
    requirement: "wp05-claude-8",
    name: "a requestId replays its result whatever the parameters",
    file: "src/ledger/requests.ts",
    from: "  if (row.params_digest !== null && row.params_digest !== key.digest) throw reused(key);",
    to: "",
    check: integration("gateway.test.ts", "replays view/url by requestId"),
  },
  {
    requirement: "wp05-claude-9",
    name: "other spellings of the unspecified address skip --url-host",
    file: "src/addressing/index.ts",
    from: "  if (WILDCARDS.has(authorityHost(bare)) && options.urlHost === undefined) {",
    to: '  if (["0.0.0.0", "::", "[::]"].includes(address) && options.urlHost === undefined) {',
    check: unit("gateway.test.ts", "a wildcard needs --url-host"),
  },
  {
    requirement: "wp05-claude-10",
    name: "bind errors other than three surface as internal errors",
    file: "src/addressing/index.ts",
    from: '      } else if (error.code === "EAFNOSUPPORT") {',
    to: "      } else if (false) {",
    also: [
      {
        file: "src/addressing/index.ts",
        from: "      } else {\n        reject(\n          bindFailed(`The gateway can't listen on ${address}: ${error.code ?? error.message}.`),\n        );\n      }",
        to: "      } else reject(error);",
      },
    ],
    check: unit("gateway.test.ts", "no other port would fix"),
  },
  {
    requirement: "wp05-claude-11",
    name: "any test clock offset is taken, negative and huge ones too",
    file: "src/instance/index.ts",
    from: "  if (!Number.isSafeInteger(offset) || offset < 0 || offset > MAX_CLOCK_OFFSET_MS) {",
    to: "  if (Number.isNaN(offset)) {",
    check: integration("gateway.test.ts", "the test clock"),
  },
  {
    requirement: "wp05-claude-spec",
    name: "a frame ticket outlives the shell session that asked for it",
    file: "src/gateway/capabilities.ts",
    from: "    if (shellSession?.token_id !== entry.tokenId) {",
    to: "    if (false) {",
    check: unit("gateway.test.ts", "while its shell session lives"),
  },
  {
    requirement: "wp05-claude-signal",
    name: "a view-only link raises signals",
    file: "src/gateway/index.ts",
    from: '      scope: () => "signal",\n',
    to: "",
    check: hygiene("view-and-review link view"),
  },
  {
    requirement: "wp05-claude-origin",
    name: "a link works at whatever address the shell moved to",
    file: "src/gateway/capabilities.ts",
    from: "    if (row.shell_origin !== this.#shellOrigin()) {",
    to: "    if (false) {",
    check: integration("gateway.test.ts", "shell moved to another port"),
  },
  // WP-05: the gateway, addressing and hygiene.
  {
    requirement: "HY-01",
    name: "any Host is accepted (DNS rebinding)",
    file: "../protocol/src/hygiene.ts",
    from: "if (host === undefined || !policy.hosts.includes(host)) {",
    to: "if (host === undefined) {",
    check: hygiene("Host allowlist"),
  },
  {
    requirement: "HY-01",
    name: "a mutation's Origin isn't checked",
    file: "../protocol/src/hygiene.ts",
    from: '      if (origin !== policy.origin) {\n        return refusal(\n          "MOSTRA_HYGIENE_ORIGIN_REFUSED",\n          origin === undefined',
    to: '      if (origin === "never") {\n        return refusal(\n          "MOSTRA_HYGIENE_ORIGIN_REFUSED",\n          origin === undefined',
    check: hygiene("exact Origin"),
  },
  {
    requirement: "HY-01",
    name: "the CSRF token isn't checked",
    file: "../protocol/src/hygiene.ts",
    from: "if (request.csrf === undefined || sent === undefined || !safeEqual(sent, request.csrf)) {",
    to: "if (request.csrf === undefined) {",
    check: hygiene("CSRF token"),
  },
  {
    requirement: "HY-01",
    name: "responses lose Cross-Origin-Resource-Policy",
    file: "src/gateway/http.ts",
    from: '"cross-origin-resource-policy": "same-origin",',
    to: "",
    check: hygiene("CORP"),
  },
  {
    requirement: "HY-01",
    name: "guessing isn't rate-limited",
    file: "src/gateway/capabilities.ts",
    from: "if (this.#failures.length < FAILURE_LIMIT) return undefined;",
    to: "return undefined;",
    check: hygiene("rate limits"),
  },
  {
    requirement: "HY-01",
    name: "the CSRF token is stored in plain text (the WP-05 finding)",
    file: "src/gateway/capabilities.ts",
    from: "        hashSecret(csrf),",
    to: "        csrf,",
    also: [
      {
        file: "src/gateway/capabilities.ts",
        from: "if (!safeEqual(hashSecret(csrf), found.session.csrf)) continue;",
        to: "if (!safeEqual(csrf, found.session.csrf)) continue;",
      },
    ],
    check: hygiene("out of the logs and the ledger"),
  },
  {
    requirement: "HY-01",
    name: "any page may frame an artifact",
    file: "src/gateway/http.ts",
    from: 'return { "content-security-policy": `frame-ancestors ${listener.shellOrigin}` };',
    to: "return {};",
    check: e2e("no other page can frame"),
    e2e: true,
  },
  {
    requirement: "HY-01",
    name: "a page elsewhere spends the guessing limit (the WP-05 review finding)",
    file: "src/gateway/index.ts",
    from: 'if (context.request.headers.get("sec-fetch-site") === "cross-site") {',
    to: "if (false) {",
    check: e2e("can't lock viewers out"),
    e2e: true,
  },
  {
    requirement: "wp05-review-1",
    name: "an IPv6 bind keeps the flag's spelling in origins and the Host allowlist",
    file: "src/addressing/index.ts",
    from: "  return new URL(`http://${isIP(bare) === 6 ? `[${bare}]` : bare}/`).hostname;",
    to: "  return isIP(bare) === 6 ? `[${bare}]` : bare;",
    check: unit("gateway.test.ts", "exact origins"),
  },
  {
    requirement: "HY-02",
    name: "the gateway listens on every interface while it reports loopback",
    file: "src/addressing/index.ts",
    from: "server.listen({ port, host: address, exclusive: true });",
    to: 'server.listen({ port, host: "0.0.0.0", exclusive: true });',
    check: integration("gateway.test.ts", "loopback only by default"),
  },
  {
    requirement: "HY-03",
    name: "scopes aren't enforced",
    file: "src/gateway/routes.ts",
    from: "        if (!allowed) {",
    to: "        if (allowed === false && needed === undefined) {",
    check: hygiene("per-scope tokens"),
  },
  {
    requirement: "HY-03",
    name: "a revoked token still works",
    file: "src/gateway/capabilities.ts",
    from: "      row.revoked_at === null &&\n",
    to: "",
    check: hygiene("410"),
  },
  {
    requirement: "HY-03",
    name: "a token's lifetime is ignored",
    file: "src/gateway/capabilities.ts",
    from: "(row.expires_at === null || Date.parse(row.expires_at) > this.#now())",
    to: "true",
    check: unit("gateway.test.ts", "expire after their ttl"),
  },
  {
    requirement: "LL-05",
    name: "a link minted without a lifetime expires after a week",
    file: "src/gateway/capabilities.ts",
    from: "expiresAt: input.ttlMs === undefined ? undefined : this.#iso(this.#now() + input.ttlMs),",
    to: "expiresAt: this.#iso(this.#now() + (input.ttlMs ?? 7 * 86_400_000)),",
    check: integration("gateway.test.ts", "after a week of simulated time"),
  },
  {
    requirement: "SH-01",
    name: "the frame is served on the shell's origin",
    file: "src/gateway/index.ts",
    from: "    const artifactOrigin = addressing.origin(port);",
    to: "    const artifactOrigin = shellOrigin();",
    check: e2e("live on two origins"),
    e2e: true,
  },
  {
    requirement: "SH-03",
    name: "session cookies are Lax and readable by scripts",
    file: "src/gateway/http.ts",
    from: "; HttpOnly; SameSite=Strict`;",
    to: "; SameSite=Lax`;",
    check: e2e("HttpOnly cookies"),
    e2e: true,
  },
  {
    requirement: "SH-03",
    name: "a lease isn't reused after a restart",
    file: "src/addressing/index.ts",
    from: "      const previous = leased(owner);",
    to: "      const previous = undefined as number | undefined;",
    check: integration("gateway.test.ts", "keeps ports and sessions across a restart"),
  },
  {
    requirement: "SH-04",
    name: "the bridge accepts messages from any origin",
    file: "../protocol/src/bridge.ts",
    from: 'if (event.origin !== options.peerOrigin) return "wrong-origin";',
    to: "",
    check: ["test/bridge.test.ts"],
    cwd: "../protocol",
  },
  {
    requirement: "SH-04",
    name: "the bridge accepts messages from any window",
    file: "../protocol/src/bridge.ts",
    from: 'if (!peer || event.source !== peer) return "wrong-source";',
    to: "",
    check: e2e("drops messages from other windows"),
    e2e: true,
  },
  {
    requirement: "RT-05",
    name: "serving a version starts a process",
    file: "src/gateway/index.ts",
    from: "    const files = async (context: RouteContext): Promise<Response> => {",
    to: '    const files = async (context: RouteContext): Promise<Response> => {\n      process.getBuiltinModule("node:child_process").spawn("sleep", ["30"]);',
    check: integration("gateway.test.ts", "no process"),
  },
  {
    requirement: "VR-03",
    name: "a damaged version is shown (the WP-05 review finding)",
    file: "src/gateway/index.ts",
    from: "      if (damage !== undefined) {\n        log.error(",
    to: '      if (damage === "never") {\n        log.error(',
    check: integration("gateway.test.ts", "damaged version"),
  },
  {
    requirement: "VR-03",
    name: "a frame reaches the whole version directory, server bundle included",
    file: "src/gateway/index.ts",
    from: 'join(artifacts.versionDir(versionId), "client")',
    to: "artifacts.versionDir(versionId)",
    check: integration("gateway.test.ts", "route enumeration"),
  },
  {
    requirement: "RT-06",
    name: "the ledger lock isn't exclusive",
    file: "src/ledger/index.ts",
    from: 'db.pragma("locking_mode = EXCLUSIVE");',
    to: "",
    check: integration("instance.test.ts", "16 daemons"),
  },
  {
    requirement: "RT-06",
    name: "a losing starter never reaches the owner",
    file: "src/home/acquire.ts",
    from: "await attach(record.socket, options.client, 2000);",
    to: 'await attach(record.socket + ".x", options.client, 2000);',
    check: integration("instance.test.ts", "16 daemons"),
  },
  {
    requirement: "RT-06",
    name: "a stale socket file isn't replaced",
    file: "src/protocol-server/server.ts",
    from: "unlinkSync(path);",
    to: "",
    check: integration("instance.test.ts", "recovers after a SIGKILL"),
  },
  {
    requirement: "RT-07",
    name: "the platform gate is skipped",
    file: "src/instance/index.ts",
    from: "if (gate) throw new RpcError(gate);",
    to: "",
    check: integration("platform.test.ts"),
  },
  {
    requirement: "RT-09",
    name: "nothing is reaped on start",
    file: "src/processes/manager.ts",
    from: "if (rows.length === 0) return [];",
    to: "return [];",
    check: integration("reaping.test.ts"),
  },
  {
    requirement: "RT-09",
    name: "a reused PID is signalled",
    file: "src/processes/manager.ts",
    from: 'if (leader && leader.startTime !== row.start_time) return "pid reused";',
    to: "",
    check: integration("reaping.test.ts"),
  },
  {
    requirement: "RT-09",
    name: "a child's group outlives it",
    file: "src/processes/manager.ts",
    from: "await endGroups([pid, ...adopted.values()], 2000);",
    to: "",
    check: integration("processes.test.ts", "take down their group"),
  },
  {
    requirement: "HO-02",
    name: "the oldest common revision is picked",
    file: "../protocol/src/revision.ts",
    from: "const newest = common.at(-1);",
    to: "const newest = common.at(0);",
    check: ["--project", "unit", "test/unit/protocol-server.test.ts"],
  },
  {
    requirement: "HO-02",
    name: "an unsupported revision is accepted",
    file: "../protocol/src/revision.ts",
    from: "if (newest !== undefined) return { ok: true, revision: newest };",
    to: "return { ok: true, revision: newest ?? (supported[0] as Revision) };",
    check: integration("protocol-suite.test.ts", "refuses an unsupported"),
  },
  // WP-03.
  {
    requirement: "AU-01",
    name: "builds drop the Tailwind baseline",
    file: "src/builder/child/spa.ts",
    from: "        tailwind(),\n",
    to: "",
    check: integration("render.test.ts", "single plain React page"),
  },
  {
    requirement: "AU-02",
    name: "server modules reach the browser unchanged",
    file: "src/builder/child/spa.ts",
    from: "serverClientStubPlugin(serverModules),",
    to: "",
    check: integration("publish.test.ts", "publishes a directory"),
  },
  {
    requirement: "AU-03",
    name: "publish writes into the artifact's directory",
    file: "src/publish/publisher.ts",
    from: "const source = await resolveSource(path);",
    to: 'const source = await resolveSource(path);\n    await writeFile(join(source.root, ".mostra-cache"), "");',
    check: integration("publish.test.ts", "writing nothing"),
  },
  {
    requirement: "AU-04",
    name: "the description is dropped",
    file: "src/registry/index.ts",
    from: "...(manifest?.description !== undefined ? { description: manifest.description } : {}),",
    to: "",
    check: integration("publish.test.ts", "metadata round-trips"),
  },
  {
    requirement: "AU-07",
    name: "a value that needs evaluation is accepted",
    file: "src/publish/manifest.ts",
    from: "    default:\n      return x.fail(",
    to: "    default:\n      return undefined as never;\n      return x.fail(",
    check: ["--project", "unit", "test/unit/manifest.test.ts"],
  },
  {
    requirement: "AU-07",
    name: "a copy claiming an ID takes it over",
    file: "src/registry/index.ts",
    from: "if (input.stillClaims(path, input.manifestId)) {",
    to: "if (false) {",
    check: integration("publish.test.ts", "refuses a copy"),
  },
  {
    requirement: "VR-01",
    name: "the version ID ignores the artifact (D89)",
    file: "src/publish/digest.ts",
    from: 'hash.update(Buffer.from(artifactId, "utf8"));',
    to: "",
    check: integration("publish.test.ts", "identical files two versions"),
  },
  {
    requirement: "VR-01",
    name: "node_modules is part of the source",
    file: "src/publish/source.ts",
    from: 'new Set(["node_modules", ".git", ".mostra"])',
    to: 'new Set([".git", ".mostra"])',
    check: integration("publish.test.ts", "ignores node_modules"),
  },
  {
    requirement: "VR-02",
    name: "a failed publish leaves its store files",
    file: "src/publish/publisher.ts",
    from: "for (const step of undo.reverse()) {",
    to: "for (const step of [] as typeof undo) {",
    check: integration("publish-faults.test.ts", "cleans up after a failure"),
  },
  {
    requirement: "VR-02",
    name: "nothing is recovered on start",
    file: "src/registry/index.ts",
    from: "return store.sweep(known);",
    to: "return { versions: [], snapshots: [] };",
    check: integration("publish-faults.test.ts", "recovers from a crash"),
  },
  {
    requirement: "VR-11",
    name: "no source snapshot is kept",
    file: "src/publish/publisher.ts",
    from: "if (existsSync(target)) return false;",
    to: "return false;",
    check: integration("publish.test.ts", "outlive their source"),
  },
  {
    requirement: "RT-02",
    name: "the supervisor imports an artifact module",
    file: "src/publish/publisher.ts",
    from: "const extracted = extractManifest(",
    to: 'await import(join(staging, "source", "live.ts")).catch(() => {});\n          const extracted = extractManifest(',
    check: integration("audit.test.ts"),
  },
  {
    requirement: "VR-02",
    name: "a publish's receipt isn't recorded with its commit",
    file: "src/registry/index.ts",
    from: "if (input.requestId !== undefined) {",
    to: "if (false) {",
    check: integration("publish-faults.test.ts", "replays the committed receipt"),
  },
  {
    requirement: "#7",
    name: "children run before they are recorded",
    file: "src/processes/manager.ts",
    from: `const GATE_SCRIPT = 'IFS= read -r go <&3 && [ "$go" = go ] || exit 125; exec 3<&-; exec "$@"';`,
    to: `const GATE_SCRIPT = 'exec 3<&-; exec "$@"';`,
    check: integration("reaping.test.ts", "recorded before it runs"),
  },
  // The D80 review's findings, each with the regression test that catches it.
  {
    requirement: "review-1",
    name: "an error reaches the host unredacted",
    file: "src/protocol-server/server.ts",
    from: "if (!redact || !(error instanceof RpcError)) throw error;",
    to: "throw error;",
    check: integration("publish.test.ts", "redacts capability material"),
  },
  {
    requirement: "review-2",
    name: "a file's failed sync is ignored",
    file: "src/registry/store.ts",
    from: 'if (!directory || !unsupported.includes(code ?? "")) throw error;',
    to: "if (false) throw error;",
    check: ["--project", "unit", "test/unit/store.test.ts"],
  },
  {
    requirement: "review-4",
    name: "a retried create doesn't finish the recorded one",
    file: "src/publish/publisher.ts",
    from: "await writeScaffold(result.dir, result.artifactId, params.title ?? basename(result.dir));",
    to: "",
    check: integration("publish-faults.test.ts", "completes the creation"),
  },
  {
    requirement: "review-5",
    name: "imports from outside the artifact are built",
    file: "src/builder/child/plugins.ts",
    from: 'if (file.startsWith("\\0") || inside(file) || !existsSync(file)) return resolved;',
    to: "return resolved;",
    check: integration("publish.test.ts", "refuses imports from outside"),
  },
  {
    requirement: "review-6",
    name: "output paths start with a slash",
    file: "src/publish/publisher.ts",
    from: 'for (const top of ["client", "server"]) {',
    to: 'for (const top of ["/client", "/server"]) {',
    check: integration("publish.test.ts", "reproduces"),
  },
  {
    requirement: "review-7",
    name: "the output digest lists execute bits the sealed tree lacks",
    file: "src/publish/publisher.ts",
    from: "files.push({ path, executable: false, sha256: await hashFile(absolute) });",
    to: "files.push({ path, executable: ((await stat(absolute)).mode & 0o111) !== 0, sha256: await hashFile(absolute) });",
    check: integration("publish.test.ts", "reproduces"),
  },
  {
    requirement: "review-8",
    name: "TypeScript wrappers hide async functions",
    file: "src/builder/child/scan.ts",
    from: "while (current !== undefined && ERASED_WRAPPERS.has(current.type)) {",
    to: "while (false) {",
    check: ["--project", "unit", "test/unit/scan.test.ts"],
  },
  {
    requirement: "review-10",
    name: "enums and namespaces pass as erased",
    file: "src/builder/child/scan.ts",
    from: 'node.type === "TSDeclareFunction";',
    to: 'node.type.startsWith("TS");',
    check: ["--project", "unit", "test/unit/scan.test.ts"],
  },
  // WP-04: dependencies (D95).
  {
    requirement: "DP-01",
    name: "warm imports are treated as on-demand packages",
    file: "src/deps/index.ts",
    from: "...[...imports.keys()].filter((name) => !(name in warm.packages)),",
    to: "...imports.keys(),",
    check: integration("deps.test.ts", "no install at all"),
  },
  {
    requirement: "DP-01",
    name: "lock layouts don't link the warm React, so pnpm installs a second one",
    file: "src/deps/index.ts",
    from: "Object.keys(warm.packages).map((name) => [name, `link:warm/${name}`]),",
    to: 'Object.keys(warm.packages).filter((name) => name !== "react").map((name) => [name, `link:warm/${name}`]),',
    check: integration("deps.test.ts", "one warm React"),
  },
  {
    requirement: "DP-02",
    name: "the explicit policy is ignored",
    file: "src/deps/index.ts",
    from: 'if (missing.length > 0 && options.policy() === "explicit") {',
    to: "if (false) {",
    check: integration("deps.test.ts", "explicit policy"),
  },
  {
    requirement: "DP-03",
    name: "the lockfile is left out of envDigest",
    file: "src/publish/publisher.ts",
    from: "lockDigest: deps.lockDigest,",
    to: 'lockDigest: "0".repeat(64),',
    check: integration("deps.test.ts", "only the lockfile changes"),
  },
  {
    requirement: "DP-03",
    name: "installed packages aren't recorded in the store index",
    file: "src/deps/index.ts",
    from: '"INSERT OR IGNORE INTO dependency_package (name, version, stored_at) VALUES (?, ?, ?)",',
    to: '"SELECT ?, ?, ?",',
    check: integration("deps.test.ts", "rebuilds a frozen version offline"),
  },
  {
    requirement: "DP-03",
    name: "a lock layout keeps linking the warm set where the runtime was",
    file: "src/deps/index.ts",
    from: "    if (target === warm.nodeModules) return;",
    to: "    return;",
    check: integration("deps.test.ts", "relinks a lock layout"),
  },
  {
    requirement: "DP-04",
    name: "MOSTRA_OFFLINE is ignored",
    file: "src/deps/index.ts",
    from: 'if (flag !== undefined && flag !== "" && !/^(?:0|false|no)$/i.test(flag)) return true;',
    to: "",
    check: integration("deps.test.ts", "within a second"),
  },
  {
    requirement: "DP-04",
    name: "offline requests go to the installer instead of the store index",
    file: "src/deps/index.ts",
    from: "        if (semver.maxSatisfying(versions, range) === null) {",
    to: "        if (Date.now() < 0) {",
    check: integration("deps.test.ts", "within a second"),
  },
  {
    requirement: "DP-05",
    name: "the install child gets the supervisor's environment",
    file: "src/deps/installer.ts",
    from: "        env,\n        onStdout:",
    to: "        env: options.env,\n        onStdout:",
    check: integration("deps.test.ts", "lifecycle scripts"),
  },
  {
    requirement: "DP-05",
    name: "a user's ignore-scripts setting stops lifecycle scripts",
    file: "src/deps/installer.ts",
    from: '        "--config.ignore-scripts=false",',
    to: "",
    check: integration("deps.test.ts", "lifecycle scripts"),
  },
  {
    requirement: "DP-05",
    name: "the install child runs in the layout, not the artifact's directory",
    file: "src/deps/installer.ts",
    from: "        cwd: run.cwd,",
    to: "        cwd: run.dir,",
    check: integration("deps.test.ts", "lifecycle scripts"),
  },
  // WP-04's GPT review findings (D80): each test, red on the code before its fix.
  {
    requirement: "wp04-review-1",
    name: "the install child doesn't end with its supervisor",
    file: "src/deps/child/install.ts",
    from: "\nconnectToSupervisor();\n",
    to: "\n",
    check: integration("deps.test.ts", "end with the supervisor"),
  },
  {
    requirement: "wp04-review-2",
    name: "the working lockfile changes before the publish commits",
    file: "src/publish/publisher.ts",
    from: '          faults.at("publish:after-dependencies");',
    to: '          ledger.write((db) => deps.save(db, key));\n          faults.at("publish:after-dependencies");',
    check: integration("deps.test.ts", "review finding 2"),
  },
  {
    requirement: "wp04-review-3-4",
    name: "offline, every spec becomes the highest stored version, exactly",
    file: "src/deps/index.ts",
    from: "    const additions = input.additions;",
    to: '    const additions = isOff ? input.additions.map((spec) => { const v = semver.maxSatisfying(stored(spec.name), "*"); return v ? { name: spec.name, range: v, exact: v } : spec; }) : input.additions;',
    check: integration("deps.test.ts", "review findings 3 and 4"),
  },
  {
    requirement: "wp04-review-5",
    name: "a layout is marked complete before the store index knows its packages",
    file: "src/deps/index.ts",
    from: "        const now = new Date().toISOString();\n        ledger.write((db) => {",
    to: '        await writeFile(join(dir, LAYOUT_MARKER), "{}\\n");\n        faults.at("deps:before-marker");\n        const now = new Date().toISOString();\n        ledger.write((db) => {',
    check: integration("deps.test.ts", "review finding 5"),
  },
  {
    requirement: "wp04-review-6",
    name: "CSS comments are scanned for imports",
    file: "src/deps/scan.ts",
    from: "  const text = withoutCssComments(source);",
    to: "  const text = source;",
    check: ["--project", "unit", "test/unit/deps.test.ts"],
  },
  // The Claude Opus review's findings (D80).
  {
    requirement: "claude-1",
    name: "any package that resolves is built, from wherever it lives",
    file: "src/builder/child/plugins.ts",
    from: "if (fromPackage && !packaged(from)) return null;",
    to: "if (fromPackage) return null;",
    check: integration("ancestors.test.ts", "undeclared dependency"),
  },
  {
    requirement: "claude-1",
    // Two independent guards stop the search: the inline config, and the staging root's own
    // package.json (PostCSS's search stops at a package root). Both are removed.
    name: "PostCSS config is searched for again",
    file: "src/builder/child/spa.ts",
    from: "css: { postcss: {} },",
    to: "",
    also: [
      {
        file: "src/builder/types.ts",
        from: '"package.json": `${JSON.stringify({ private: true, type: "module" }, null, 2)}\\n`,',
        to: "",
      },
    ],
    check: integration("ancestors.test.ts", "runs no PostCSS config"),
  },
  {
    requirement: "claude-1",
    name: "a tsconfig.json above the home sets the compile options",
    file: "src/builder/types.ts",
    from: '"tsconfig.json": `',
    to: '"tsconfig.unused.json": `',
    check: integration("ancestors.test.ts", "compiles with Mostra's settings"),
  },
  {
    requirement: "claude-2",
    name: "a server module without a stub reaches the client",
    file: "src/builder/child/scan.ts",
    from: '".cts",',
    to: "",
    check: integration("publish.test.ts", "cts server module"),
  },
  {
    requirement: "claude-3",
    name: "a damaged version is left as it is",
    file: "src/publish/publisher.ts",
    from: "if (!exists || damage !== undefined) {",
    to: "if (!exists) {",
    check: integration("publish.test.ts", "rebuilds a lost"),
  },
];

const runtime = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(runtime, "../..");
const { values } = parseArgs({ options: { only: { type: "string" } } });

function build(): void {
  for (const name of ["@mostra/protocol", "@mostra/react", "@mostra/shell", "@mostra/runtime"]) {
    execFileSync("pnpm", ["--filter", name, "build"], { cwd: root, stdio: "ignore" });
  }
}

function check(seed: Seed): { ok: boolean; summary: string } {
  const result = seed.e2e
    ? spawnSync("npx", ["playwright", "test", ...seed.check], {
        cwd: join(root, "tests", "e2e"),
        encoding: "utf8",
      })
    : spawnSync("npx", ["vitest", "run", ...seed.check], {
        cwd: join(runtime, seed.cwd ?? "."),
        encoding: "utf8",
      });
  const text = stripVTControlCharacters(`${result.stdout}${result.stderr}`);
  const summary =
    text
      .split("\n")
      .find((line) => line.includes("Tests ") || /^\s*\d+ (passed|failed)/.test(line)) ??
    "no summary";
  return { ok: result.status === 0, summary: summary.trim() };
}

let restore: (() => void) | undefined;
process.on("SIGINT", () => {
  restore?.();
  process.exit(130);
});

let missed = 0;
for (const seed of SEEDS) {
  if (values.only && seed.requirement !== values.only) continue;
  const edits = [{ file: seed.file, from: seed.from, to: seed.to }, ...(seed.also ?? [])];
  const originals = edits.map((edit) => {
    const path = join(runtime, edit.file);
    return { path, edit, text: readFileSync(path, "utf8") };
  });
  const absent = originals.find(({ edit, text }) => !text.includes(edit.from));
  if (absent) {
    console.log(`${seed.requirement} | ${seed.name} | SEED NOT FOUND in ${absent.edit.file}`);
    missed++;
    continue;
  }
  restore = () => {
    for (const { path, text } of originals) writeFileSync(path, text);
  };
  let red: { ok: boolean; summary: string };
  try {
    for (const { path, edit } of originals) {
      writeFileSync(path, readFileSync(path, "utf8").replace(edit.from, edit.to));
    }
    build();
    red = check(seed);
  } finally {
    restore();
    restore = undefined;
  }
  build();
  const green = check(seed);
  if (red.ok || !green.ok) missed++;
  console.log(
    `${seed.requirement} | ${seed.name} | seeded: ${red.ok ? "GREEN (missed)" : "red"} (${red.summary}) | restored: ${green.ok ? "green" : "RED"} (${green.summary})`,
  );
}
process.exit(missed === 0 ? 0 : 1);
