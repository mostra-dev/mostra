# WP-01 progress: repository foundation and protocol package

**Status:** Done. Accepted by Mirza on 2026-10-10 (M12), merged to `main` as `536d151`, finalized after the merge (work-packages/README.md §4).

## Baseline

| | |
|---|---|
| Branch | `wp/01-foundation`, created from `origin/main` |
| Starting `HEAD` | `6dd219169177e1bd3786e424440c3f5bc8750c6c` (`origin/main` at session start, 2026-10-10) |
| `git status` | clean |
| `pnpm check` | not available: no `package.json` existed (`ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND`). WP-01 creates it |
| Predecessors | none (WP-01 depends on nothing); no earlier `PROGRESS-WP-*.md` or `RECOVERY-WP-01-*.md` |
| Local toolchain | Node 24.12.0, npm 11.6.2, pnpm 10.27.0 (global; the pinned `packageManager` pnpm 12.9.0 takes over), Rust 1.97.1, macOS arm64 |
| Pull request | [#1](https://github.com/mostra-dev/mostra/pull/1), merged |

## What was built

- **Workspace:** pnpm 12.9.0 with every version in catalogs, a 7-day minimum release age, trust-downgrade refusal, an install-script allowlist and exotic-source blocking; Turborepo; TypeScript 7 project references with the STANDARDS strict flags; Biome; ESLint for React hooks; Changesets; lefthook; a Playwright Test scaffold in three engines (`tests/e2e`); a cargo workspace with a reserved, unpublished `mostra-host` crate.
- **`@mostra/protocol`:** ID kinds for every INTERFACES §1 prefix plus cursors; `VersionId.fromSha256` (D77); dated revisions with `negotiateRevision` and the `MOSTRA_HOST_REVISION_UNSUPPORTED` refusal (D78); the `Diagnostic` schema with the INTERFACES §13 areas; the per-area diagnostic catalog with `createDiagnostic`; `defineMethod` and the method registry; JSON Schema 2020-12 and draft-07 bundles; the API report. 37 tests.
- **One job list** (`tools/check/jobs.ts`) drives `pnpm check`, `pnpm check --affected`, `--fast` (pre-push) and every CI job (`pnpm check --job <name>`).
- **Gates:** dependency-cruiser rules generated from the package map (`tools/package-map.ts`), knip, size-limit, API Extractor with the changeset rule, publint, attw, wire-schema compatibility, the license audit, repository lint (catalog-only specifiers, pinned actions, workflow permissions, package docs and repository fields, canonical LICENSE and NOTICE), commit messages with DCO, the diagnostic catalog, design-document drift, links, cargo fmt, clippy, nextest and cargo-deny. Each has a seeded-violation test (`tools/test/gates.test.ts`, `tools/test/license-audit.test.ts`).
- **Generators:** `pnpm gen package | diagnostic | protocol-method`; `pnpm fix`.
- **CI:** `ci.yml` (plan, nine check jobs, Rust on Linux and macOS, dependency review, the `ci-ok` aggregate), `codeql.yml` (JavaScript/TypeScript, Actions, Rust), `scorecard.yml`; Renovate configuration; all actions pinned by SHA.
- **Repository settings as code:** `tools/github/settings.ts` and `.github/rulesets/` (D79).
- **Documentation:** governance files, README, root `AGENTS.md` and `CLAUDE.md`, package `AGENTS.md` files, six playbooks in `docs/agents/`, generated diagnostic references in `docs/reference/`.

## Decisions taken in the package

- D77 version IDs in Crockford base32, D78 first host protocol revision `2026-10-10`, D79 protected `main` with no bypass (M11).
- Wire schemas are published in Zod's `io: "input"` form: objects accept unknown fields, so receivers survive additive changes. Diagnostic codes on the wire accept any area for the same reason.
- First-time pins honor the same 7-day cooldown as Renovate (Playwright 1.63.0 rather than 1.64.0).
- A diagnostic code's severity is fixed by its catalog entry; an occurrence may give a more specific hint.
- Repository tools are TypeScript run directly by Node 24 (no build step); tools that need TypeScript's compiler API live in `tools/ts6`.

## Deviations from the design

- REPO_STANDARDS §4 said "TypeScript 6 only for API Extractor". API Extractor always analyzes with its own bundled TypeScript 5.9.3; TypeScript 6 is needed by typescript-eslint and dependency-cruiser. §4 is corrected (M11 Q7).
- The work-package protocol and PROMPT.md said to push the finalized report to `main`; under D79 it lands through a pull request.
- `tools/design/evidence_matrix.py` and `wp_specs.py` gained `--check` modes for the docs job; a committed Python bytecode file was removed.

## Repository settings changed (D76, D79)

Applied and verified by `node tools/github/settings.ts apply|verify`:

- private vulnerability reporting on; Dependabot vulnerability alerts on (the dependency graph that dependency review needs);
- secret scanning and push protection on;
- Actions: SHA pinning required, default workflow token read-only, workflows can't approve pull requests;
- merges: merge commits only (squash and rebase off), auto-merge allowed, branch update allowed, head branches deleted after merge, web commits signed off, wiki off;
- ruleset `main`: pull request required (no approvals, conversations resolved, merge method `merge`), required check `ci-ok` from GitHub Actions with up-to-date branches, CodeQL code scanning (errors and high-severity alerts block), no deletion, no force push, no bypass actors;
- ruleset `release tags`: no deletion, update or force push of any tag;
- labels `dependencies`, `security`, `prose-review`, `public-api`;
- GitHub Pages on, built by Actions, at `https://mostra-dev.github.io/mostra/` (WP-26 deploys it).

## Evidence

| ID | State | Check | Command | Result |
|---|---|---|---|---|
| EN-01 | verified | LICENSE is the canonical Apache-2.0 text (SHA-256 `cfc7749b…3d30`) and NOTICE exists, checked by repository lint; CONTRIBUTING carries the DCO; the `commits` job rejects an unsigned, non-conventional commit; lefthook's commit-msg hook rejects it locally | `pnpm --filter @mostra/tools test` (gates › commits, repository lint › LICENSE); `git commit --allow-empty -m "Add stuff"`; CI `commits` job on PR #1 | red on seeded unsigned commit, tampered LICENSE and deleted NOTICE; green on the fix; local hook printed both violations and refused the commit |
| EN-02 | verified | Tooling baseline (pnpm 12, Turborepo, Changesets, tsdown, TypeScript 7, Vitest 5, Playwright, Biome, ESLint hooks, API Extractor, publint, attw, cargo fmt, clippy, cargo-deny) pinned through catalogs; repository lint rejects a version outside a catalog; every CI job runs `pnpm check --job <name>` | `pnpm check`; CI run [38077818981](https://github.com/mostra-dev/mostra/actions/runs/38077818981); gates › repository lint › catalogs; `pnpm --filter @mostra/e2e e2e` | local `pnpm check` and CI pass the same jobs; seeded `"zod": "^4.6.5"` red, `catalog:` green; e2e harness green in Chromium, Firefox and WebKit |
| EN-04 | verified | API Extractor fails on a stale report in CI, writes it locally, and the changeset rule fails until a changeset names the package; publint and attw fail on a broken types path | `pnpm --filter @mostra/tools test` (gates › API reports) | red on seeded export (stale report, then no changeset) and on a seeded missing `.d.ts`; green after the changeset and the fix |
| EN-06 | verified | Pinned action SHAs (repository lint plus the repository's SHA-pinning requirement); CodeQL on three languages; dependency review; Renovate with a 7-day minimum release age; Scorecard | gates › repository lint › unpinned action; CodeQL and dependency review on PR #1; `renovate-config-validator renovate.json` | unpinned `actions/checkout@v4` red, pinned green; CodeQL and dependency review green on PR #1; Renovate config valid. External: Renovate installed by Mirza, autoclosed its onboarding PR on our config and opened the [Dependency Dashboard](https://github.com/mostra-dev/mostra/issues/4), with npm updates held by the 7-day release age; Scorecard [run 38083859394](https://github.com/mostra-dev/mostra/actions/runs/38083859394) on `main` published a score of 7.4 |
| EN-07 | verified | CI under 10 minutes with parallel, affected-only jobs; seeded violations caught by each gate; lefthook hooks run | full run [38076222130](https://github.com/mostra-dev/mostra/actions/runs/38076222130); typical one-package PR [#2](https://github.com/mostra-dev/mostra/pull/2) run [38077999613](https://github.com/mostra-dev/mostra/actions/runs/38077999613); `pnpm --filter @mostra/tools test` | full run 3m03s; typical PR 1m57s (plan: `@mostra/protocol`; licenses, rust and docs skipped); every gate red on its seed and green on the fix; pre-commit (Biome), commit-msg and pre-push (`pnpm check --fast`) ran on real commits and pushes |
| HY-06 | verified | SECURITY.md with private vulnerability reporting enabled (repository setting checked) | `gh api repos/mostra-dev/mostra/private-vulnerability-reporting`; `node tools/github/settings.ts verify` | `{"enabled":true}`; settings verify green; Mirza accepted the package with SECURITY.md (M12) |
| DP-06 | verified | License audit fails on a seeded PolyForm dependency in the core, on any `@pnpm/pnpr*` package, on PolyForm terms hidden under an MIT `license` field as in pnpm's `pnpr/`, and on a non-OSI engine reached through an installed peer; passes on the real tree | `pnpm --filter @mostra/tools test` (license-audit); CI `licenses` job | red on each seed with the dependency path named; green on this repository |
| KT-02 | verified | License audit fails on a seeded non-OSI engine ("SEE LICENSE IN" with PolyForm text) in a published package's production closure; passes on the real tree | `pnpm --filter @mostra/tools test` (license-audit › PolyForm-licensed engine); CI `licenses` job | red on the seed, green on the real tree |
| HO-07 | verified | The schema snapshot check fails on a removed field, a removed enum value, a newly required field, a narrowed type, a removed bundle and a custom refinement, and accepts an additive change once regenerated; a breaking change passes only under a new revision with the old bundle kept for 12 months; rules unit-tested, including constraints beside references and unions, tuples, `oneOf`, recursion and fail-closed unknown keywords | `pnpm --filter @mostra/tools test` (gates › wire schemas, rules › schema compatibility); CI `api` job | four seeds red with the path and reason named; additive change green. Boundary: the browser-protocol, CLI JSON and MCP tool surfaces don't exist yet; their packages register bundles in `scripts/wire-schemas.ts` and get the same check |
| AX-03 | verified | Diagnostic schema validation; catalog JSON and one docs page per code generated; the docs check fails on a code without docs text and on a removed code; codes appear in the API report (`hostDiagnosticCodes`) | `pnpm --filter @mostra/protocol test`; gates › diagnostic catalog; `node tools/docs/diagnostics.ts check` | malformed diagnostics rejected; generated code without text red; removed code red; current catalog green |

## Independent review (D80)

- **GPT-6.1-Sol** through the Codex CLI (OpenAI, ChatGPT sign-in), effort high, 2026-10-10, read-only on `origin/main...HEAD` at `1d28de8`: 3,179,229 input tokens (3,022,080 cached), 18,268 output tokens (10,286 reasoning). Mirza approved the run (M12). It was run with `codex exec` and a WP-specific prompt, because codex-cli 0.162.1 refuses `codex review --base` together with custom instructions; the playbook now uses `codex review --base`.
- **GitHub Copilot** review was requested (by API, and automatically by the `main` ruleset from now on) and answered "unable to review … the user who requested the review has reached their quota limit". Not pursued (M12).

All 13 GPT findings held up and are fixed, each with a regression test (marked "review finding N" in `tools/test/` and `packages/protocol/test/`):

| # | Finding | Fix |
|---|---|---|
| 1 | `--base` didn't reach Turbo tasks, and cached `api`/`schemas` results ignored the base | `pnpm check` resolves the merge base once and exports `MOSTRA_BASE`; `turbo.json` hashes it into `api` and `schemas` |
| 2 | Removing or renaming a schema bundle skipped compatibility | Bundles are compared as a set; a bundle may disappear only 12 months after its successor revision |
| 3 | A revision bump excused every break, with no old revision kept | A break needs a newer revision **and** the base bundle kept unchanged under its old revision |
| 4 | Constraints beside `$ref` or a union were ignored | Nodes split into conjuncts; each new conjunct is checked, old ones merged or distributed |
| 5 | New tuple positions escaped checking | Every position either side constrains is compared, then the tail |
| 6 | `oneOf` was treated as `anyOf` | A changed `oneOf` fails closed |
| 7 | Custom refinements narrowed silently; `Revision`'s JSON Schema accepted `2026-02-30` | Wire-schema generation rejects custom refinements; `Revision` uses `z.iso.date()` |
| 8 | The license audit skipped installed peer dependencies | Installed peers are walked |
| 9 | A failed Turbo run could report a job as passed | Unexecuted tasks, failed prerequisites and an unexplained Turbo failure fail the job |
| 10 | Changes to the check machinery skipped jobs it controls | `tools/check/`, `tools/lib/`, the CI workflow and setup action make the run a full one |
| 11 | An unresolvable explicit base silently fell back | It is an error |
| 12 | DCO checks skipped merge commits | Merges are checked for a sign-off; CI checks the PR head, not GitHub's synthetic merge |
| 13 | Quoted keys or flow mappings hid unpinned actions | Workflows are parsed as YAML |

## Agent-facing prose (D74)

Mirza delegated the drafts on 2026-10-10 (M11 Q6) and accepted them with the package (M12): root `AGENTS.md`, `packages/protocol/AGENTS.md`, `crates/mostra-host/AGENTS.md`, the `MOSTRA_HOST_REVISION_UNSUPPORTED` hint and docs text, the `docs/agents/` playbooks. WP-14 finalizes the root AGENTS.md.

## Untested boundaries

- The browser-protocol, CLI JSON and MCP tool schema surfaces don't exist yet. Their packages (WP-05, WP-10, WP-15) register bundles in `scripts/wire-schemas.ts` and inherit the HO-07 check.
- The `e2e`, `hygiene`, `conformance` and `examples` CI jobs of REPO_STANDARDS §6 arrive with the packages they test (WP-05 onward); the Playwright harness already runs in Chromium, Firefox and WebKit.
- Copilot code review is requested automatically on every pull request push, but Copilot declines on a quota limit of the requesting account (M12: not pursued).
- Scorecard 7.4: Code-Review and Branch-Protection are lowered by having no required approvals (a single maintainer, D79), Maintained and Contributors by the repository's age, and CII-Best-Practices by the absence of an OpenSSF badge registration. None is a defect in the configuration.

## Commits and publication

- **Range:** `6dd2191..536d151` on `main`: 25 signed-off commits on `wp/01-foundation` (`6a5c70d` to `93d7005`) and the merge commit `536d151` of [#1](https://github.com/mostra-dev/mostra/pull/1). This report lands through its own pull request (D79).
- **On `main` after the merge:** CI [38083859353](https://github.com/mostra-dev/mostra/actions/runs/38083859353), CodeQL [38083859363](https://github.com/mostra-dev/mostra/actions/runs/38083859363) and Scorecard [38083859394](https://github.com/mostra-dev/mostra/actions/runs/38083859394), all green.
- **Packages:** nothing published. `@mostra/protocol` carries a changeset for its first minor release; the release pipeline is WP-11's (EN-05).
- **Docs:** GitHub Pages enabled; WP-26 deploys the site.
- **Remaining dirty paths:** none in the repository. Outside it, the session removed its own scratch copy and, with Mirza's authorization (M12), the reinstallable `node_modules` of the finished EVAL-01 runs in `~/.jcode/scratch/eval-base` (about 20 GB; sources, lockfiles, builds and logs kept).

## Next

WP-02, instance, ledger and host protocol server (`docs/design/work-packages/WP-02.md`).
