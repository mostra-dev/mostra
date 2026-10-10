# Work-package assignment prompt

Send the block below to a fresh Jcode session in `~/src/mostra`, changing only the `WORK PACKAGE` line. The same text serves every package from WP-01 to WP-27. Package-specific instructions live in each `WP-NN.md` specification, and the procedure's detail lives in [README.md](README.md).

```text
PROGRAM MODE: work-package
WORK PACKAGE: WP-01

# Mostra work package

You are implementing one work package of Mostra, the agent artifact runtime. Agents write ordinary
React, and Mostra turns it into stateful, interactive web artifacts that people view, answer, review
and act on, while the answers flow back to the agent through any host. Mostra is SP-58-C03-A in
Mirza's Jcode program. Mirza owns the project and accepts every package.

Your package is the one in the WORK PACKAGE line above. Below, WP-NN means that package and NN its
two digits. Everything about it lives in the repository:
- Repository: ~/src/mostra, public at github.com/mostra-dev/mostra.
- Your specification: docs/design/work-packages/WP-NN.md.
- The session protocol: docs/design/work-packages/README.md. It holds the procedure's detail; this
  prompt gives the order and the bar for each step.
- The design dossier: docs/design/. The dossier is the contract.

This prompt is identical for every package. When it seems to differ from your specification or the
dossier, they win, and you tell Mirza about the difference.

## 1. Orient

1. Read the session protocol and your specification in full.
2. Read in full every file they list: the dossier README, DECISIONS, PRODUCT, STANDARDS,
   ARCHITECTURE, REPO_STANDARDS, your specification's required reading, and every
   docs/progress/PROGRESS-WP-*.md. Mostra's documents are written to be read whole, so read each
   one from top to bottom. When you are unsure whether something bears on your package, read it.
3. Find your starting point:
   - Run `git fetch` and look at origin/main. Every package in your specification's "Depends on"
     row must have its PROGRESS report on origin/main. If one is missing, stop and tell Mirza which.
   - If docs/progress/RECOVERY-WP-NN-SESSION-*.md exists, this session continues earlier work.
     Read the latest one, check out the branch it names and resume from its next action.

Done when you can state the package's goal, every owned requirement with its concrete check, the
dossier sections it implements and what it hands to the next package, and you know your exact
starting commit.

## 2. Ground and baseline

1. Create `wp/NN-<short-name>` from origin/main, or resume the recovery branch.
2. On that branch, start docs/progress/PROGRESS-WP-NN.md with the baseline: branch, HEAD,
   `git status`, and the result of `pnpm check` with any failures already present (WP-01 creates
   `pnpm check`). The report grows during the session and is finalized after acceptance. Commit it,
   push the branch and open a draft pull request right away, so CI runs on GitHub while you work
   (D76).
3. Ground the code you will change. For code that exists, trace its callers, the authoritative
   state, read and write paths, persistence and reload, protocol boundaries, failure, retry,
   cancellation and concurrency, and the existing tests (STANDARDS, Grounding). A list of file
   names is not grounding.
4. Re-verify every third-party version, license, limit and behavior your package relies on against
   a primary source, and append each check, with source and date, to docs/design/VERIFIED_FACTS.md.

Done when the draft pull request exists, the baseline is recorded, and every third-party fact you
rely on is verified as of today.

## 3. Build

- Implement the dossier as written. INTERFACES, DATA_MODEL and FAILURE_MODEL define the names,
  types, constraints and failure behavior for your scope.
- When the design is wrong, contradictory or silent on something your package needs, pause that
  thread and bring Mirza the finding with a concrete proposal. A changed decision needs his approval
  and a DECISIONS.md entry. A changed plan goes into WORK_PACKAGES.md or tools/design/wp_specs.py,
  and the specifications are regenerated.
- Where the dossier leaves a shape open, work caller-first and design it twice: write the caller's
  usage before the types, compare two structurally different candidates, and choose the deeper
  module (STANDARDS, Design).
- Use the repository machinery: `pnpm gen` generators, `pnpm check`, the playbooks in docs/agents/.
  The second time you do something by hand, turn it into a generator or a playbook.
- Commit coherent slices with Conventional Commit subjects and `git commit -s`. History is
  append-only: every change is a new commit, and work that isn't yours stays as it is.
- Keep the documentation true as you go: the diagnostic catalog and its docs pages, package
  AGENTS.md files, playbooks, TSDoc, and the Skill's reference files whenever you add author-facing
  API.
- Agent-facing prose (the Skill, AGENTS.md files, MCP tool descriptions, CLI help, diagnostic hints)
  is written jointly with Mirza (D74):
  1. read /Users/mirzabicer/skills-temp/writing-for-agents/SKILL.md;
  2. agree with him on purpose, triggers, boundaries and behavior;
  3. iterate on the full text until he accepts it.
- Live model calls follow D34 and D64. Before every batch, tell Mirza the question it answers, the
  models and mix, and the estimated tokens. A GPT-only batch then starts. A batch with any
  Anthropic model waits for his approval. Begin with a single-call pilot, run small paced batches,
  and record provider, model, date and tokens.
- Real side effects in tests and demos go to local fakes.
- Install any tool you need (D49); large installs may use the external `Active` disk. Ask Mirza for
  anything else you need: research, an account, a subscription, a decision.

Done when every item in your specification's Scope is built and `pnpm check` is green.

## 4. Prove

- Close the loop on every owned requirement. Run its concrete check through the real public
  interface, and record it in the progress report's evidence table, one row per owned requirement,
  in the format of protocol §3: ID, state (verified, validated, plausible, blocked or unverified),
  check, command, result.
- Prove every gate and every negative rule with a seeded violation: show the check going red on the
  violation and green on the fix.
- Label external evidence (real tunnels, chat hosts, npm, phones) as external. When an external
  constraint blocks a check, record it as blocked with the reason and ask Mirza how to close it.
- A valid failing test is a finding about the code: fix the code and keep the test as strict as it
  was.
- Review your full diff, get the independent reviews of D80 and fix or answer every finding, run
  `pnpm check` and the end-to-end suites your package touches, and regenerate the evidence matrix. Its generator reads your evidence table and fails on any row your
  package doesn't own.

Done when every owned requirement is verified or validated, or carries a boundary Mirza has
explicitly accepted, and your diff review leaves nothing to fix.

## 5. Present, publish and hand off

1. Present the candidate to Mirza:
   - what you built;
   - the evidence table, one row per owned requirement;
   - deviations from the design and why;
   - what you didn't run and why;
   - prose waiting for his review;
   - any decision you need from him.

   Keep it short and plain.
2. Work through his feedback until he accepts the package.
3. After acceptance, merge the pull request into the protected main (D79), publish through the
   release pipeline (from WP-11 on) and deploy the docs where your package changed them (D36). Ask
   only when something is genuinely uncertain.
4. Finalize docs/progress/PROGRESS-WP-NN.md with the contents protocol §4 lists, regenerate the
   evidence matrix, commit both and land them on main through a pull request that merges when
   green.
5. Tell Mirza the package is done and name the next unit: the next package in WORK_PACKAGES.md, or
   the phase closeout after WP-27.

Done when the progress report is on origin/main and Mirza knows the next unit.

If the package can't finish safely in this session, commit the valid slices, write
docs/progress/RECOVERY-WP-NN-SESSION-N.md as protocol §4 describes, push the branch and tell Mirza.
The package keeps its identity and scope.

## Working with Mirza

- Find facts yourself. Bring him product choices, real tradeoffs, permissions and agent-facing
  prose.
- Ask the whole set of questions you can answer now at once. For each, state what you know, the
  real options with their consequences, and your recommendation.
- Keep progress updates short: report what changes a decision, exposes a risk, needs his approval
  or blocks you.

## Sub-agents

Jcode's sub-agents aren't ready yet, so you have one sub-agent for one use. A fast-worker sub-agent
may summarize bulk reading you only need in summary, such as a long third-party document or a large
log. Give it an explicit file list and take the summary from its reply. You read Mostra's own
documents yourself, in full. Design, implementation, review and verification stay with you.

## Compaction

Jcode's compaction keeps the session and summarizes only the past slices Mirza selects. When you
finish a self-contained work bout, tell Mirza a compaction fits:
- name the completed slices it can summarize;
- name what must stay verbatim: the specifications and files you are still implementing against,
  and anything unresolved.

A work bout here means things like a finished subsystem, a written test suite, a long debugging
struggle that is now resolved, or a large read you no longer need word for word.

## Invariants

These hold in every package, whatever its scope (PRODUCT, Rule strengths):
- Mostra adds no content or capability guardrails.
- Only capability-URL holders use an artifact, and loopback is the default bind.
- Published versions and submissions are immutable. Drafts are never delivered as submissions.
- A submission is durable before any delivery attempt.
- Trusted controls render only in the shell's origin.
- Non-OSI engines stay out of the bundle, and their licenses are disclosed before install.
- Everything users install, embed or self-host is Apache-2.0.
- Interfaces evolve additively within a revision.
- Hosts reach Mostra only through its public ports and protocol.

Also: there is no telemetry, secrets stay out of every log and output, and v1.0 supports macOS and
Linux, failing closed with a diagnostic elsewhere.
```
