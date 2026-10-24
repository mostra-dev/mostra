# Mostra repository standards

**Status:** Settled (D50, D65). This is the authority for how the Mostra repository is built, checked, documented and released. [STANDARDS.md](STANDARDS.md) governs how work is done; this document specifies the machinery that makes doing it right the easy path. WP-01 bootstraps all of it before the first product code lands.

## 1. Goals

- **Agents don't repeat work.** Every recurring task has one command, one generator or one playbook.
- **Good code is the path of least resistance.** Boundaries, formats, API reports, licenses and docs are checked mechanically, so a worker learns about a mistake within seconds locally and minutes in CI.
- **Nothing waits for something it doesn't depend on.** Checks run in parallel, only for what changed, from shared caches.
- **One source of truth per fact.** Reference material (CLI help, diagnostic catalog, API reports, protocol schemas) is generated from source and never hand-copied.

## 2. Layout

```text
mostra/
  AGENTS.md  CLAUDE.md (imports AGENTS.md)  README.md  LICENSE  NOTICE  SECURITY.md
  CONTRIBUTING.md  GOVERNANCE.md  CODE_OF_CONDUCT.md
  docs/design/        the dossier (this folder) and work-packages/WP-NN.md
  docs/progress/      PROGRESS-WP-NN.md, RECOVERY-WP-NN-SESSION-N.md
  docs/research/      research reports
  docs/agents/        playbooks: add-diagnostic, add-protocol-method, add-kit-component, add-contract,
                      add-template, add-cli-command, update-dependency, write-e2e-test
  packages/           npm packages (§3)
  crates/             mostra-host, its codegen and reference host (D143), mostra-term-capture
  plugins/            first-party plugins (each an npm package)
  skills/mostra/      the Agent Skill (single source for harness plugins)
  templates/          `mostra new` templates, one per family
  examples/           gallery artifacts; every one passes `mostra verify` in CI
  apps/docs/          the documentation site, built with Mostra
  tests/              cross-package end-to-end, conformance runs, hygiene negative tests, fixtures
  tools/              repo tooling: generators, license audit, harness-plugin generator, release scripts
  ee/                 enterprise features of self-hosted servers, source-available under a commercial
                      license (D118); created by the first package that needs it, never imported by the core
```

Everything outside `ee/` is Apache-2.0 (D14, D118). The managed service's operating layer is not in this repository (D116).

## 3. Packages

These are package map P2 (D65): packages follow audience and process boundaries.

| Package | Audience | May depend on | Must not depend on |
|---|---|---|---|
| `@mostra/protocol` | everything | zod | anything with I/O |
| `@mostra/react` | artifact authors (browser) | protocol, react | Node built-ins, runtime, worker |
| `@mostra/server` | artifact authors (worker) | protocol | runtime, react |
| `@mostra/kit` | artifact authors | react, protocol, kit libraries | runtime, worker, Node built-ins |
| `@mostra/runtime` | runtime bundle | protocol, hono, better-sqlite3, vite (in builder entry only) | react, kit, worker internals |
| `@mostra/worker` | runtime bundle | protocol, server | runtime |
| `@mostra/verify` | runtime bundle | protocol, playwright, axe-core | runtime internals |
| `@mostra/shell` | runtime bundle | react, protocol, kit tokens | runtime |
| `@mostra/warm` (unpublished) | runtime bundle: the warm set artifacts resolve (D91) | react, the kit and the other warm packages, as dependencies only; it has no code | runtime, worker |
| `@mostra/bundle` (unpublished) | the runtime bundle's assembler (D142): what a bundle carries, its Node.js pins, the assembler, smoke tests and release scripts | the packages a bundle carries, as dependencies only | |
| `@mostra/pty-host` | runtime bundle | node-pty, protocol | runtime |
| `@mostra/sdk` | JavaScript hosts | protocol | runtime internals (spawns it) |
| `@mostra/cli` | agents, people | protocol, sdk | runtime internals |
| `create-mostra` | people | cli | |
| `@mostra/conformance` | host authors | protocol, sdk | runtime internals |
| `@mostra/contract-*` | plugin authors | protocol | everything else |
| crate `mostra-host` | Rust hosts | serde, tokio, and the crates its HTTP download, TLS, archives and digests need (D143) | anything of Mostra but the published protocol schema |
| crate `mostra-host-codegen` (unpublished) | the crate's wire types: typify over the draft-07 bundle, `write` and `check` (D143) | typify, schemars, syn | |
| crate `mostra-host-reference` (unpublished) | the conformance kit's Rust reference host (D143) | `mostra-host`, tokio | |
| crate `mostra-win` (unpublished) | the runtime on Windows (D150): owner-only access lists, the control pipe and its client, the child gate with Job Objects, process identity; and `mostra-win-service`, the login service's windowless launcher (D151); shipped in the Windows bundles from WP-W3 | windows-sys, serde_json | anything of Mostra |
| crate `mostra-term-capture` | ratatui authors | ratatui, serde | |
| `ee/*` (D118) | operators of self-hosted servers | the core's public packages | nothing in the core may depend on `ee/` |

Inside `@mostra/runtime` the modules are deep and owned: `ledger`, `interaction`, `gateway`, `addressing`, `registry`, `publish`, `deps`, `processes`, `live`, `actions` (calls and action runs), `workers` (the launchers and the worker pool), `secrets` (the home's store and the secrets port), `service` (idle exit and the login service; WP-08 added these four), `verify` (the pipeline, its sandbox, the type check and the runner child's client; WP-09), `gc` (the reference rules, collected versions and the collection of everything else nothing references; WP-10), `dev` (`mostra dev`'s sessions: the source's mirror, the dev server child and the sandbox it previews in; WP-10), `share`, `protocol-server`, `builder` (child entry), `home` (the platform gate, resolution, permissions, the runtime directory and acquisition, D85), `platform` (every difference between POSIX and Windows: home defaults, owner-only directories, the control endpoint, process identity, the child gate and reaping, file operations; WP-W1, D150) and `instance`, the composition root, which assembles the others and holds no policy of its own (D85). Each module has one public `index.ts`, and dependency-cruiser forbids imports into another module's internals. The package's binary, `mostra-runtime host|daemon`, is the runtime bundle's entry point (D85).

## 4. Toolchain

These are pinned through pnpm catalogs, and versions are re-verified when a WP touches them (VERIFIED_FACTS).

| Concern | Choice |
|---|---|
| Runtime | Node 24 LTS now, 26 LTS after 2026-10-28 (D48); `.node-version` and `engines` |
| Packages | pnpm 12 workspaces with catalogs; `pnpm-workspace.yaml` lists packages, plugins, apps, templates, examples |
| Tasks | Turborepo with remote-compatible caching (local cache in CI through `actions/cache`) |
| Builds | tsdown for libraries; Vite 8 for the shell and docs |
| Types | TypeScript 7 `tsc -b` with project references; `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `isolatedDeclarations`; a pinned TypeScript 6 (`tools/ts6`) for tools that need the JavaScript compiler API: typescript-eslint and dependency-cruiser, and the system typings of API Extractor, which analyzes with its own bundled TypeScript (VERIFIED_FACTS, WP-01) |
| Format and lint | Biome (format and lint), ESLint only for `react-hooks`; `cargo fmt`, `clippy -D warnings` |
| Tests | Vitest 5 (unit, and browser mode through Playwright); Playwright Test for end-to-end in Chromium, Firefox and WebKit; `cargo nextest` |
| Boundaries and hygiene | dependency-cruiser (§3 rules), knip (unused files, exports, dependencies), size-limit (`@mostra/react` and `@mostra/kit` entry budgets) |
| API surface | API Extractor reports (`*.api.md`, committed), publint, are-the-types-wrong |
| Licenses | `tools/license-audit` over the resolved dependency tree (OSI-only core, `pnpr/` excluded, D20, D26; `ee/` audited apart from the core, which never reaches it, D118) and, with `--bundle`, over each assembled runtime bundle on its own platform (D142); the api gate's packing check proves no published core tarball contains anything of `ee/` (EN-09); `cargo-deny` |
| Editors | `.editorconfig`; VS Code workspace settings and recommended extensions (Biome, ESLint, rust-analyzer, Playwright) so the language servers work across project references |

## 5. Local workflow

- `pnpm check` runs every CI gate through Turborepo, in parallel and cached. The browser suites (`e2e`) start once the other task jobs are done: CI runs each job on its own machine, and on one machine three browsers beside the real-process suites time out (found in WP-07's and WP-08's baselines). `pnpm check --affected` limits it to packages changed since `origin/main`. CI runs the same tasks, so "green locally" means "green in CI" except for cross-platform legs.
- `pnpm fix` applies Biome, ESLint and lint autofixes.
- `pnpm gen <playbook>` runs a generator (new package, diagnostic code, protocol method, kit component, contract, template), so new things start in the right shape.
- **lefthook:**
  - `pre-commit` formats and lints staged files (seconds);
  - `commit-msg` checks the commit format and the `Signed-off-by` trailer;
  - `pre-push` runs `pnpm check --affected --fast` (types, unit tests and boundaries for changed packages).

## 6. CI (GitHub Actions)

- All actions are pinned by SHA. Permissions default to `contents: read`. Concurrency groups cancel superseded runs on the same ref.
- **Plan job.** It computes affected packages with Turborepo and emits a matrix. Every other job depends only on it.

| Job | Runs when | Notes |
|---|---|---|
| format-lint | always | Biome, ESLint (hooks), `cargo fmt`, clippy |
| types | affected TS | `tsc -b` |
| unit | affected | Vitest, sharded by package |
| build | affected | tsdown and Vite; artifacts uploaded for later jobs |
| boundaries | always | dependency-cruiser, knip, and the seed anchors (every seeded violation of `prove-seeds.ts` still finds what it plants into) |
| api | affected public packages | API Extractor diff, publint, attw; a changed report needs a changeset |
| windows | when unit, integration or hygiene runs | the unit, hygiene and integration jobs on `windows-latest` and `windows-11-arm` for the packages ported to Windows so far (`WINDOWS_PACKAGES` in `tools/check/jobs.ts`), with `MOSTRA_DEV_WINDOWS=1`, the helper built by Cargo and a second local user for the access checks (WP-W1, D150). The integration suites run in Windows groups of their own, one machine each, which partition every runtime suite (`windows`, `windows-publish`, `windows-gateway` with the firewall on and audited, `windows-workers`, `windows-verify`, `windows-verify-failures`) plus the CLI's (`windows-clients`); a unit test fails on a suite in none or two (WP-W2, D151). WP-W3 adds the SDK's, `create-mostra`'s and the conformance kit's, and from WP-W3 on every package keeps these legs green |
| windows-seeds (`windows-seeds.yml`) | by hand (`workflow_dispatch`) | a requirement's seeded violations (`prove-seeds.ts --only`) on a Windows runner, x64 or arm64, for the seeds only Windows can run (WP-W1) |
| e2e | runtime, react, shell, kit affected | Playwright on Chromium, Firefox and WebKit as a matrix, one engine per machine (`MOSTRA_E2E_BROWSER`), on macOS and Linux, and Chromium and Firefox on Windows (x64 and arm64; WebKit, whose Windows port no viewer uses, stays on macOS and Linux, D151) |
| integration | runtime, protocol, CLI, SDK or create-mostra affected | suites through real Mostra processes (sockets, process groups, start times) on macOS and Linux (D86), in groups of suites, one machine each (`MOSTRA_TEST_GROUP`: `core`, `verify`, `verify-failures`, partitioning the runtime's files by name, in `packages/runtime/vitest.config.ts`, and `clients` for the CLI's, the SDK's and `create-mostra`'s suites); a group nearing the target gets split again |
| hygiene | runtime affected | negative tests (bad Host, bad Origin, missing token, CSRF, revoked token) |
| conformance | runtime, protocol, sdk, shell, conformance or crates affected | the kit against the Rust reference host, its standalone mode and its broken mode with its baseline, on macOS and Linux (D143); the TypeScript reference host's runs are in `integration`'s `clients` group |
| examples | examples, templates, kit, runtime affected | `mostra verify` on every example and template, sharded; visual and ARIA baselines compared |
| rust | crates affected | `cargo nextest` on macOS and Linux; `cargo-deny` |
| licenses | lockfile or Cargo.lock changed | license audit |
| docs | docs or generated references affected | build `apps/docs`, check generated references are current, check links |
| release (`release.yml`) | pull requests touching any package, the license audit, the api gate, the lockfile or the workflow (docs alone don't); every push to `main` | the four runtime bundles built, audited and smoke-tested with no Node.js, the npm path smoke-tested, the release dry run; publishing on `main` only (§9) |
| supply-chain | pull requests | dependency review, CodeQL (weekly and on PR), OpenSSF Scorecard (weekly) |

- **Target:** under 10 minutes wall-clock for a typical pull request (D50). The plan job prints the critical path, so slow jobs are visible.
- **Caches** (pnpm store, Turborepo, Playwright browsers and, on Linux, the apt packages their engines need, cargo, Vitest) are keyed by lockfiles, tool versions and the runner image.
- **Required checks** on `main`: every job above whose plan output says it should run.

## 7. Commits, branches and pull requests

- **Branches.** One branch per WP (`wp/NN-short-name`), based on the accepted predecessor. Mostra never rewrites history, resets, cleans or force-pushes (STANDARDS).
- **Commits.** Conventional Commits with the package as scope (`feat(runtime): …`, `fix(react): …`, `docs(design): …`). The subject is factual and imperative. Each commit is one coherent change and carries `Signed-off-by` (DCO, checked in CI).
- **Changesets.** Every user-visible change to a published package carries a changeset. Packages stay at 0.x until the host protocol freezes (STANDARDS versioning).
- **The pull request template** lists:
  - the WP and the requirement IDs touched;
  - the evidence: checks run and their results, what was not run and why;
  - screenshots for visible changes;
  - API report changes;
  - agent-facing prose changes, which need Mirza's review (STANDARDS prose).
- **Merging.** Merge commits, never squash or rebase merges, so commit history stays the record. CODEOWNERS covers `docs/design/`, `packages/protocol/` and agent-facing prose.

## 8. Documentation for workers and users

- **Root `AGENTS.md`:** commands, the package map with links, invariants and the module that owns each, the WP workflow, labels, D49 working agreements (fast-worker for summaries only, ask Mirza freely, install tools freely, request named-slice compactions), where each kind of doc lives, and the rule to read more when in doubt.
- **Per package:**
  - an `AGENTS.md` (purpose, the invariants it owns, its public interface file, tests to run, gotchas);
  - a `README.md` for humans;
  - TSDoc on every public export.
- **Playbooks** in `docs/agents/` for every recurring task, each ending in a checkable completion criterion.
- **WP specifications** list their required reading, erring towards more.
- **Generated references:** the CLI help, the diagnostic catalog (one docs page per code), API reports, protocol schemas and `llms.txt` are all generated in CI from source.
- **The docs site** is built with Mostra (AX-07) and deployed to GitHub Pages under `mostra-dev` (D37). The base URL is configurable, so a domain can come later without code changes.

## 9. Releases

- **One version per release** (D142 item 7): every published package but the extension contracts is one Changesets `fixed` group, so a release names one runtime bundle per platform.
- **The version pull request** (`changeset version`) is opened by the session that finishes an accepted package (`docs/agents/release.md`). Its merge to `main` runs `.github/workflows/release.yml` (D67, D142 item 9). Every run builds a bundle per platform on its own runner (macOS arm64 and x64, Linux x64 and arm64; Windows x64 and arm64 from WP-W3, D146), audits and smoke-tests each with no Node.js, packs every package and dry-runs its publish, and smoke-tests the npm path. For a version with no changeset pending and no published release, it then publishes in the protected `release` environment (only `main` deploys there, one run at a time), in this order:
  - a GitHub artifact attestation per bundle, and the GitHub release (tag `v` plus the version, immutable) with the bundles, their asset records and `SHA256SUMS`, checked from outside before anything goes to npm;
  - npm with trusted publishing, direct, provenance, tokens disallowed per package, from exactly the tarballs the smoke tests used;
  - crates.io with `rust-lang/crates-io-auth-action`, once a crate is publishable (WP-12);
  - the docs site, once it exists (WP-26).

  Pull requests that touch distribution run everything but the publish. A release that failed after it was published is finished by the next run (re-run or push), from the release's own tag and archives, never a new build (`docs/agents/release.md`, D142 item 9).
- **One-time account steps** are Mirza's, before the first release: `tools/release/npm-setup.sh` publishes a placeholder for each new package (npm configures trusted publishing only for a package that exists), configures its trusted publisher and sets "Require two-factor authentication and disallow tokens"; each configuration must publish within 2 days. A crate's first release needs one crates.io token (VERIFIED_FACTS, WP-11), then its trusted publisher (WP-12).
- **Authority.** Accepting a WP authorizes its publication (D36). The worker asks only when something is genuinely uncertain.

## 10. Supply chain

- **Renovate:** a minimum release age of 7 days for npm and crates, grouped updates per catalog, with the churn guidance (D48) updated in the same pull request when a major changes.
- **New dependencies:** each one is reviewed for maintenance, license and install scripts, recorded in the pull request, and checked by the license audit.
- **Security process:** `SECURITY.md` with private vulnerability reporting enabled, secret scanning and push protection on.
- **Telemetry** (D119). Only the standalone CLI sends anonymous usage telemetry, with a first-run notice and an opt-out (a setting, an environment variable or `DO_NOT_TRACK=1`). Embedded use never sends any: the SDK, the Rust crate, host-spawned instances and every home a host configures send nothing (H-16). The endpoint is configurable and disabled in development builds; the event list is public (WP-10).
