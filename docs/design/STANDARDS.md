# Mostra standards

**Authority.** This standard governs all Mostra work: the C03-A phase design, its work packages and its closeout. It adapts the engineering, verification and session standards of Mirza's Jcode program to a standalone open-source TypeScript and Rust project. C03-A doesn't need those program files. Everything that applies is here.

When sources disagree, use this order:
1. Mirza's latest explicit decision.
2. [DECISIONS.md](DECISIONS.md) and later accepted Mostra decision records.
3. This standard.
4. The accepted Mostra design dossier.
5. The active work-package specification.
6. Earlier progress reports and recovery handoffs.
7. The research reports and other historical material.

Current source and runtime evidence show what Mostra does. Documents say what it should do. A mismatch is a finding to resolve.

## Decision labels

Design documents label statements wherever ambiguity would matter:
- **Approved decision:** Mirza accepted it.
- **Design input:** a preference, example or concern not yet settled.
- **Observation:** a fact checked against a named source and date.
- **Hypothesis:** plausible, but still needs evidence.
- **Deferred decision:** assigned to a named later point in the same unit. It is not permission to omit the outcome.
- **Out of scope:** belongs to another named unit or outside the project.

A research recommendation is a design input until Mirza accepts it.

## Rule strengths

- **Invariant.** Cannot be violated by ordinary judgment. Changing one needs Mirza's explicit approval and an update to every affected document.
- **Requirement.** An outcome the work must deliver. The implementer chooses how unless the design narrows it. A unit cannot close with an applicable requirement missing, unverified or silently deferred.
- **Default.** The expected approach when evidence doesn't favor another. Deviate when facts support a better result, and record the deviation, the evidence and its consequence.
- **Guidance.** Helps judgment. It is not a completion condition.

## Lifecycle

Mostra uses the same three session modes as Mirza's program, under the identity **SP-58-C03-A**:

1. **Phase design** (`PROGRAM MODE: phase-design`, `PHASE: SP-58-C03-A`). Produces the implementation-ready dossier and work-package sequence with Mirza, then records design approval. Only prototypes and research, never production code.
2. **Work package** (`PROGRAM MODE: work-package`, `WORK PACKAGE: WP-NN`). Implements, integrates and verifies one approved package, gets Mirza's acceptance, then writes `docs/progress/PROGRESS-WP-NN.md`. One package per session.
3. **Phase closeout** (`PROGRAM MODE: phase-closeout`). Verifies the combined v1 against the full requirement matrix, repairs integration defects, gets Mirza's acceptance and writes `docs/design/PHASE_COMPLETION.md`.

**Where things live.** The dossier lives in `docs/design/` in the Mostra repository, starting from this seed. WP specifications go in `docs/design/work-packages/WP-NN.md`, progress reports in `docs/progress/`, and research in `docs/research/`.

**Design session steps:**
1. Load this seed in its reading order.
2. Re-verify the research facts the design depends on.
3. Map the decision tree, and ask Mirza the currently answerable frontier in dependency order with recommendations.
4. Compare at least two structurally different candidates for each open shape.
5. Record decisions with labels.
6. Write the dossier.
7. Define work packages that each fit one fresh session and cover every requirement exactly once as primary owner.
8. Define acceptance.
9. Present the complete design for approval.
10. After approval, finalize routing and hand Mirza the first WP assignment.

**Work-package steps:**
1. Load the dossier, the WP and prior progress.
2. Re-ground the code the WP changes, and record the baseline (branch, HEAD, status, failing checks).
3. Implement in coherent commits.
4. Surface design contradictions instead of bolting on workarounds.
5. Verify continuously.
6. Review the full diff.
7. Present the candidate with evidence.
8. After Mirza accepts it, publish under whatever authorization exists ([Consequential actions](#consequential-actions)), then write the progress report.

**Continuation.** If a package can't finish safely in one session, commit the valid slices and write `docs/progress/RECOVERY-WP-NN-SESSION-N.md`. Record exact Git state, completed and missing requirements, evidence, failed attempts and the next action. The package keeps its identity and scope.

**Reports** are evidence and handoff documents, not diaries. Record decisions, exact commits, verification with untested boundaries, deviations and the next unit.

## Completion

Deliver the complete accepted outcome:
- No placeholder behavior, hidden fallback, weak edge case or misleading configuration may remain in scope.
- Splitting work into packages never shrinks the product.
- Completeness means the smallest coherent design that handles the approved behavior, failure modes and integration boundaries, not the most layers.

## Grounding

- **Greenfield work** grounds itself in facts. Re-verify each third-party version, license, limit and behavior the design depends on against a primary source, and record the source and date.
- **Existing Mostra code:** trace the caller, authoritative state, read and write paths, persistence and reload, protocol boundaries, failure, retry, cancellation and concurrency, and the existing tests before changing it. Naming files is not grounding.
- **Prototypes and spikes** in a scratch location are encouraged during design to settle questions (for example the shadcn base evaluation, terminal fidelity fixtures and process-model spikes). They never become production code by accident.

## Design

- **Write the caller's usage first.** Start from the agent writing an artifact, the human using it, the host integrating it and the plugin author extending it. Derive types and modules from that usage.
- **Prefer deep modules:** a small interface hiding real policy. Reject:
  - callers coordinating internal stages;
  - leaked transport or storage representations;
  - modules split only by execution order;
  - pass-through layers;
  - options that expose internals without a caller need.
- **Design it twice.** Compare at least two structurally different candidates for every non-trivial shape. Record why the winner won and what it borrowed.
- **One owner and one source of truth per invariant.** Encode invariants in types and constructors. Validate external input at boundaries. Make retryable transitions idempotent. Define conflict, ordering, crash and retry behavior wherever two actors write shared state.
- **Repeated friction of the same shape means the design is wrong.** Examples are repeated workarounds, escape-hatch types and repeated special cases. Redesign instead of accumulating patches.

## Failure handling

- **Fix root causes.** A retry, fallback or guard is not a fix while the underlying state is wrong.
- **Errors** name the failed operation and what the caller can do. Agent-facing errors follow the diagnostics schema (stable code, hint, docs link).
- **Define behavior for:**
  - invalid or missing configuration;
  - partial persistence;
  - timeouts;
  - cancellation;
  - process crash;
  - duplicate execution;
  - stale versions;
  - concurrent tabs and clients;
  - host unavailability;
  - unsupported platforms.
- **Fail closed** when pretending would corrupt state, lose input, leak data or mislead the user.

## Security, privacy and hygiene

- **The product rules** are D05 (no guardrails) and D06 (only capability holders), implemented through the checklist in [ARCHITECTURE.md](ARCHITECTURE.md#10-hygiene-and-remote-viewing). Never add a capability restriction. Never skip a hygiene item.
- **Secrets** stay out of logs, diagnostics, reports, fixtures, screenshots and exported bundles. Redact capability tokens everywhere.
- **No telemetry.** The core does not phone home.
- **Supply chain:**
  - review each new dependency's maintenance, license and install scripts;
  - keep the core OSI-only, with a license audit in CI;
  - pin GitHub Actions by SHA;
  - apply a release-age cooldown for dependency updates.

## Consequential actions

These need Mirza's explicit approval each time, unless a standing authorization below covers them:
- Creating or renaming the public GitHub organization or repository; changing its visibility, settings or permissions.
- Creating npm organizations and configuring trusted publishing for the first time.
- Registering domains, trademark filings and any spending.
- Live model calls that use any Anthropic model (D34).
- Any real external side effect in tests or demos: sending email, posting to services or calling paid APIs. Examples and tests use local fakes or explicitly approved sandbox accounts.
- Deleting user data or anything outside the project's own build artifacts and caches.

**Standing authorizations.**
- **Publication (D36).** Mirza's acceptance of a work package authorizes every publication step for it: pushing to the public repository, publishing to npm and crates.io, creating releases and deploying the docs site. Ask only when something is uncertain or a real dilemma arises.
- **Tools (D49).** Agents may install any tool without asking. Large installs may use the external disk `Active` when the internal disk is tight. This extends the 2026-09-18T21:12:17.500Z authorization.
- **GPT-only evaluation batches (D34)** start after the agent announces them; they don't wait for approval.

None of these waive the other items above.

## Repository discipline

- Before editing, record the branch, HEAD, status and baseline failures, and protect unrelated paths.
- Work on one branch per WP, based on the accepted predecessor.
- Commit coherent, scoped changes with explicit staging and factual subjects. Every commit is signed off (`git commit -s`) under the DCO.
- Never reset, clean, stash, amend, rebase, force-push or overwrite unrelated work.
- At closeout, report the source HEAD, commit range, any publication refs and the remaining dirty paths.

## Verification

**Evidence rule.** A completion claim needs evidence that exercises the claimed behavior. Inspection can support a claim, but it can't replace an available real path. Map every requirement to a concrete check. Aggregate test counts prove nothing per requirement. Report what passed, what failed, what was not run and why.

**Layers** (choose the ones the change needs and say why):
1. Pure logic: unit and property tests.
2. Boundaries: protocol, schema, persistence, migration and configuration tests.
3. Integration: real supervisor, gateway, workers and storage.
4. Browser end-to-end through Playwright against the real gateway, in Chromium, Firefox and WebKit where behavior differs. Include the hygiene negative tests.
5. Host conformance: the kit run against the standalone adapters and a reference test host.
6. Cross-platform: macOS and Linux CI.
7. External: real tunnels, real MCP hosts and real npm installs, labelled as external evidence.
8. Agent evaluation (D33): opt-in and budgeted.
9. Mirza's review: visual design, prose and representative artifacts.

**Closed loops.** Prefer checks through the same public interface the user or agent uses. Keep iterating while a relevant check exposes a defect. Never delete, loosen or rewrite a valid failing test to pass. If a test encodes obsolete behavior, cite the decision that replaced it.

**Evidence states:**
- **Verified:** the real workflow passed.
- **Validated:** representative tests and integration boundaries passed.
- **Plausible:** a meaningful boundary is still untested.
- **Blocked:** an external constraint prevented the check.
- **Unverified:** no adequate evidence.

A requirement with plausible or unverified evidence is incomplete unless Mirza accepts the boundary.

**Agent evaluations and live models.**
- **What they measure:** toolkit ergonomics (first-pass `verify` success, turns to pass, retention across turns), never prose wording.
- **Before every batch run (D34):** tell Mirza the question the batch answers, the models and their ratio, and the estimated cost in tokens. Wait for his approval when any Anthropic model is involved.
- **Models (D34):** mostly GPT-6.1-Sol with some Claude Sonnet 5.5 and Claude Opus 5.5, roughly 70/15/15, chosen per question to keep variety. Authenticate with OAuth logins, never API keys.
- **Recording:** record the provider, model, date and token usage. They are not a routine CI gate.

## Prose

- **Agent-facing prose** is consequential: the Agent Skill, AGENTS.md templates, MCP tool descriptions, CLI help and diagnostic hints. Draft it jointly with Mirza. Agree on purpose, triggers, boundaries and behavior first, then iterate on the full text until he accepts it.
- **Quality is accepted by review and field use, never by phrase tests or snapshot tests of wording.** Mechanism tests may use placeholder text to check discovery, loading and rendering.
- **Writing rules for agents:** front-load trigger words in descriptions, use one word per concept (the [vocabulary](PRODUCT.md#vocabulary)), prefer positive instructions, disclose reference material behind pointers instead of bloating the main file, and keep each meaning in one place.
- **Human-facing docs:** plain words, active voice, sentence-case headings, concrete facts over adjectives. Avoid filler and AI tells such as em dashes, puffery and inflated vocabulary.

## Tooling baseline

**Default.** Re-verify the versions at design time.

**TypeScript tooling:**

| Concern | Choice |
|---|---|
| Package manager | pnpm 12 with catalogs (D48); never the `pnpr/` subsystem |
| Task runner | Turborepo |
| Versioning | Changesets |
| Library builds | tsdown |
| Type checking | TypeScript 7 `tsc` with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `isolatedDeclarations`; a pinned TypeScript 6 for tools that need the JS compiler API |
| Tests | Vitest 5 (browser mode through Playwright, D48); Playwright Test for end-to-end; visual and ARIA baselines committed |
| Lint and format | Biome or Oxlint, plus ESLint for React hooks rules |
| API surface | API Extractor reports gate pull requests; publint and are-the-types-wrong |
| Accessibility | axe-core |

**Rust:** stable toolchain, `cargo fmt --check`, `cargo clippy -D warnings`, `cargo-deny` for licenses and advisories.

**Supply chain and security:** Renovate with a minimum release age, CodeQL, dependency review, OpenSSF Scorecard, `SECURITY.md` with private vulnerability reporting.

**Publishing:** npm trusted publishing (OIDC) with provenance and staged publishing, after Mirza authorizes it. No long-lived npm tokens.

**Governance files:** `LICENSE` (Apache-2.0), `NOTICE`, `CONTRIBUTING.md` (DCO), `GOVERNANCE.md`, `CODE_OF_CONDUCT.md`, `AGENTS.md`.

## Versioning

- **Libraries** follow semver through Changesets and stay at 0.x until the host protocol freezes. The public surface is:
  - API reports;
  - diagnostic codes;
  - CLI flags and JSON output schemas;
  - configuration keys;
  - extension contract versions.
- **The host protocol** uses dated revisions with a deprecation window of at least 12 months. Every message carries its revision, and hosts and Mostra negotiate the highest common one.
- **Change rule:** interfaces change additively within a version (D32). A breaking change goes into a new revision or major version with a migration note and a codemod where practical.

## Documentation

- **Shipped docs** state current behavior, configuration, limits and recovery.
- **The dossier** keeps decisions and rationale.
- **Progress reports** keep evidence.
- **No copies of what the environment already shows,** such as `--help` output or file lists, unless the copy serves navigation or acceptance.
- **The docs site** is built with Mostra.

## Working with Mirza

- **Find facts yourself.** Ask Mirza about product choices, meaningful tradeoffs, permissions and consequential prose.
- **Questions** state what is known, the open decision, the real alternatives with consequences, and a recommendation. Ask the full currently answerable set in dependency order. Questions that depend on unanswered ones wait.
- **Ask for anything (D49).** Agents may ask Mirza for anything at any time, including new external research reports and subscriptions.
- **Sub-agents (D49).** `fast-worker` is the only sub-agent Mostra agents use, and only to read and summarize bulk material that doesn't need to stay in full context, with an explicit file list and the summary returned in the response, not written to a file. Don't delegate design analysis. Read files yourself whenever a summary isn't enough.
- **Context compaction (D49).** At natural points, especially after finishing a self-contained stretch of work, ask Mirza for a compaction. Compaction summarizes named slices of earlier work, not the whole session, so name the slices that can be summarized and the required reading that must stay.
- **Communication.** Keep progress updates short. Surface what changes a decision, exposes risk, needs approval or blocks work.
