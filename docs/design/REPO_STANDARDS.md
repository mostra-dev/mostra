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
  crates/             mostra-host, mostra-term-capture
  plugins/            first-party plugins (each an npm package)
  skills/mostra/      the Agent Skill (single source for harness plugins)
  templates/          `mostra new` templates, one per family
  examples/           gallery artifacts; every one passes `mostra verify` in CI
  apps/docs/          the documentation site, built with Mostra
  tests/              cross-package end-to-end, conformance runs, hygiene negative tests, fixtures
  tools/              repo tooling: generators, license audit, harness-plugin generator, release scripts
```

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
| `@mostra/pty-host` | runtime bundle | node-pty, protocol | runtime |
| `@mostra/sdk` | JavaScript hosts | protocol | runtime internals (spawns it) |
| `@mostra/cli` | agents, people | protocol, sdk | runtime internals |
| `create-mostra` | people | cli | |
| `@mostra/conformance` | host authors | protocol, sdk | runtime internals |
| `@mostra/contract-*` | plugin authors | protocol | everything else |
| crate `mostra-host` | Rust hosts | serde, tokio | |
| crate `mostra-term-capture` | ratatui authors | ratatui, serde | |

Inside `@mostra/runtime` the modules are deep and owned: `ledger`, `interaction`, `gateway`, `addressing`, `registry`, `publish`, `deps`, `processes`, `live`, `share`, `protocol-server`, `builder` (child entry), `home` (the platform gate, resolution, permissions, the runtime directory and acquisition, D85) and `instance`, the composition root, which assembles the others and holds no policy of its own (D85). Each module has one public `index.ts`, and dependency-cruiser forbids imports into another module's internals. The package's binary, `mostra-runtime host|daemon`, is the runtime bundle's entry point (D85).

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
| Licenses | `tools/license-audit` over the resolved dependency tree (OSI-only core, `pnpr/` excluded, D20, D26); `cargo-deny` |
| Editors | `.editorconfig`; VS Code workspace settings and recommended extensions (Biome, ESLint, rust-analyzer, Playwright) so the language servers work across project references |

## 5. Local workflow

- `pnpm check` runs every CI gate through Turborepo, in parallel and cached. `pnpm check --affected` limits it to packages changed since `origin/main`. CI runs the same tasks, so "green locally" means "green in CI" except for cross-platform legs.
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
| boundaries | always | dependency-cruiser, knip |
| api | affected public packages | API Extractor diff, publint, attw; a changed report needs a changeset |
| e2e | runtime, react, shell, kit affected | Playwright on Chromium, Firefox and WebKit as a matrix; macOS and Linux for platform-specific suites |
| integration | runtime or protocol affected | suites through real Mostra processes (sockets, process groups, start times) on macOS and Linux (D86) |
| hygiene | runtime affected | negative tests (bad Host, bad Origin, missing token, CSRF, revoked token) |
| conformance | runtime, sdk, crates affected | the kit against standalone adapters and the reference test host |
| examples | examples, templates, kit, runtime affected | `mostra verify` on every example and template, sharded; visual and ARIA baselines compared |
| rust | crates affected | `cargo nextest` on macOS and Linux; `cargo-deny` |
| licenses | lockfile or Cargo.lock changed | license audit |
| docs | docs or generated references affected | build `apps/docs`, check generated references are current, check links |
| supply-chain | pull requests | dependency review, CodeQL (weekly and on PR), OpenSSF Scorecard (weekly) |

- **Target:** under 10 minutes wall-clock for a typical pull request (D50). The plan job prints the critical path, so slow jobs are visible.
- **Caches** (pnpm store, Turborepo, Playwright browsers, cargo, Vitest) are keyed by lockfiles and tool versions.
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

- **Changesets** keeps a release pull request open. Merging it runs the release workflow in the protected `release` environment (D67):
  - npm publish with trusted publishing, direct, provenance automatic, tokens disallowed per package;
  - crates.io with `rust-lang/crates-io-auth-action`;
  - runtime bundles built per platform (macOS arm64 and x64, Linux x64 and arm64) with a SHA-256 manifest and a GitHub artifact attestation, attached to the GitHub release;
  - the docs site deployed.
- **One-time account steps** are Mirza's:
  - create the npm organization;
  - configure trusted publishers per package (each new configuration must publish within 2 days);
  - set "disallow tokens";
  - possibly create one crates.io token per crate for its first release (hypothesis, VERIFIED_FACTS).

  The release WP prepares exact instructions.
- **Authority.** Accepting a WP authorizes its publication (D36). The worker asks only when something is genuinely uncertain.

## 10. Supply chain

- **Renovate:** a minimum release age of 7 days for npm and crates, grouped updates per catalog, with the churn guidance (D48) updated in the same pull request when a major changes.
- **New dependencies:** each one is reviewed for maintenance, license and install scripts, recorded in the pull request, and checked by the license audit.
- **Security process:** `SECURITY.md` with private vulnerability reporting enabled, secret scanning and push protection on.
- **No telemetry** in any package (H-16).
