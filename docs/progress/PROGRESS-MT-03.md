# MT-03 progress: the operator ports as specified, and what sign-in and metering lack

**Status:** In progress. A maintenance unit after WP-31 ([specification](../design/work-packages/MT-03.md)); it owns no requirement of its own, and the checks it adds extend HO-09's and HY-08's rows. Its scope is eight items: `limits` for relayed runs, waiting runs and calls; a link's idle expiry on a fresh visit; GitHub's public counts and chosen OpenID Connect claims in `facts`; the verifier recorded per identity and verified providers an operator module supplies; a home's held bytes in metering; the version being pushed in `limits`' query; and a design for homes an organization owns, brought to Mirza.

## Baseline

| | |
|---|---|
| Branch | `mt/03-operator-ports`, created from `origin/main` |
| Starting `HEAD` | `764cbc8` (`origin/main`, 2026-11-12: "docs: WP-31's closeout, Mostra 0.12.0, WP-16 next (#143)") |
| `git status` | clean |
| `pnpm check` | on `764cbc8` in a detached worktree (`temp/mt03/baseline`, git-ignored), after a fresh `pnpm install --frozen-lockfile`, 59 min 26 s while this session's own suites ran beside it: every job passed (format-lint, types, integration, hygiene, e2e, build, boundaries, api, licenses, rust, conformance, docs, commits) but `unit`, which failed three property cases on their 30 s under the load (`gc.test.ts`'s two VR-06 cases and `interaction.test.ts`'s fields property, the class MT-02 and WP-30 recorded); both files passed alone at once (46 of 46). The baseline is green |
| Predecessors | WP-31 done ([PROGRESS-WP-31](PROGRESS-WP-31.md) on `origin/main`); no `RECOVERY-MT-03-*.md` |
| Local toolchain | Node 24.22.1 (`.node-version`), pnpm 12.14.0, macOS 26.2 arm64 |
| Disk | 17 GiB free on the internal disk at the start |

## Decisions

- **D169** (proposed, brought with the candidate): MT-03's choices under D123. `limits` for relayed actions (`run` before a run is recorded, `run.wait` when it would wait for an absent owner, `call` before a plain call is relayed; refusals with the operator's words, the link's use given back, joins never asked, no answer lets the action through); idle expiry judged from the link's last view; GitHub's public counts and an `oidc` entry's chosen `claims` in `facts`; the verifier recorded on each identity, filled once for older rows, and `IdentityProvider.verifies`; `bytes.held` as a level; `LimitQuery.versionId`; maintenance units in the specification generators.
- **Homes an organization owns**: a design for decision, [rounds/MT-03-ORGANIZATION-HOMES.md](../design/rounds/MT-03-ORGANIZATION-HOMES.md), with eight questions and a recommendation for each; no code (the specification's item 7). Waiting on Mirza.
- **M64** (2026-11-12T10:17:14Z): Mirza started the unit with the assignment prompt and its specification.

## Slices

| Commit | Slice |
|---|---|
| `0058d5b` | MT-03 in WORK_PACKAGES.md; `wp_specs.py` and `evidence_matrix.py` accept maintenance units; the generated specification |
| `7598020` | This report's baseline |
| `dcafbe0` | `@mostra/protocol/operator`: `LimitQuery.versionId`, `bytes.held`, `IdentityProvider.verifies`, `run`/`run.wait`/`call` documented; `MOSTRA_REMOTE_QUEUE_FULL`'s docs; the changeset |
| `e95c11b` | The runtime: the relay asks `limits`; idle expiry by view (ledger migration 17); GitHub counts and chosen claims in `facts`; verifiers on identities (directory migration 5) and `verifies`; held sizes (directory migration 6) and `bytes.held`; `versionId` on pushes |
| `32cace3` | The checks through a real server (`operator-relay.test.ts`, `signin-facts.test.ts`, three cases of `operator.test.ts`), the unit suites (`metering.test.ts`, `server-config.test.ts`), the fake providers, 18 seeds and two RM-04 seeds re-anchored |
| `8945f92` | The operator API report, idle expiry's TSDoc, the regenerated diagnostic page, the stronger held-size seed |
| `aec515d`, `4e0e12f` | D169 and the dossier (INTERFACES §18.3, §18.5, §18.6; DATA_MODEL §7.1; FAILURE_MODEL §11.3; VERIFIED_FACTS); the design for organization-owned homes |

## Evidence

MT-03 owns no requirement (D152): one row per item of its scope, each checked through the real interface (a real `mostra-runtime server` loading the fixture operator module `test/fixtures/operator.mjs`, local fakes of GitHub and an OpenID Connect issuer, real owner daemons, pages through the real front and gateway) with its seeded violations (`node packages/runtime/scripts/prove-seeds.ts --only MT-03`) red when planted and green when restored. The checks extend HO-09's row (items 1, 2, 6, 9) and HY-08's (items 3 to 5).

| Item | State | Check | Command | Result |
|---|---|---|---|---|
| 1. `limits` for `run`, `run.wait`, `call` | verified | The operator refuses `run` three times and `call` once on a link allowed three relayed actions a minute: each answers 403 `MOSTRA_REMOTE_LIMIT_REACHED` with the operator's message, nothing reaches the owner (the fake mail server got nothing), the refused key later starts a new run (nothing was recorded), and the link's next run passes (every use was given back); the query names the artifact, its route and quantity 1, and `run.wait` isn't asked while the owner is connected. A retried request that joins its run is answered without asking, though the operator now refuses runs. With the operator hanging, a run and a call go through within its 2 s. With the owner stopped, a refused `run.wait` answers 503 `MOSTRA_REMOTE_QUEUE_FULL` with the operator's message and records nothing; with the operator hanging the run is recorded `waiting` and runs once when the owner returns | `vitest --project integration operator-relay.test.ts`; `prove-seeds.ts --only MT-03 --name "1:"` | 4 tests pass; 5 seeds red, then green (no `run` ask, no `call` ask, no `run.wait` ask, a refused run's use kept, a join asked) |
| 2. Idle expiry on a fresh visit | verified | With `idleExpiry: "3s"`, a link viewed and viewed again a second later by another browser opens; 3.5 s later a browser that never opened it exchanges the link and its frame ticket answers 410 `MOSTRA_HYGIENE_TOKEN_REVOKED`, and the link stays revoked for any browser; WP-30's case (an open page's later ticket refused) still passes | `vitest --project integration operator.test.ts -t "fresh visit"`; `prove-seeds.ts --only MT-03 --name "2:"` | pass; 1 seed red (idleness judged by the sessions' `last_seen_at`, the old query), then green |
| 3. GitHub's public counts | validated | A GitHub sign-in through the fake GitHub hands `accounts.resolve` `facts` `{ login, createdAt, publicRepos: 37, publicGists: 4, followers: 128 }` from the one `GET /user` answer. External, read only: GitHub's real `GET /user` gives `public_repos`, `public_gists` and `followers` as numbers and `created_at` as a string (`gh api user`, 2026-11-12), as its documentation says for a token without scopes (VERIFIED_FACTS, MT-03) | `vitest --project integration signin-facts.test.ts -t "public counts"`; `gh api user`; `prove-seeds.ts --only MT-03 --name "3:"` | pass; 1 seed red, then green. A sign-in through real GitHub wasn't run (Untested boundaries) |
| 4. Chosen OpenID Connect claims | validated | With `claims: ["hd", "groups", "absent"]` the fake issuer's ID token gives `facts` `{ hd: "example.com", groups: ["staff", "ops"] }` (`absent` isn't in the token, `acr` wasn't chosen); an entry without `claims` passes no `facts`; `claims` on a `github` entry, an empty list, nine names or a name that isn't one stop the server with `MOSTRA_REMOTE_CONFIG_INVALID` naming the key | `vitest --project integration signin-facts.test.ts -t "chosen claims"`; `vitest --project unit server-config.test.ts`; `prove-seeds.ts --only MT-03 --name "4:"` | pass; 2 seeds red (claims dropped; every claim passed without `claims`), then green |
| 5. The verifier on the identity; module providers that verify | verified | An owner signed in through GitHub shows "Ada Lovelace", verified with GitHub, on its hosted page's sender line; after the server restarts with the provider renamed (`github` → `gh`) the line is unchanged; an identity cleared to how an upgrade finds it takes "GitHub" from the configuration at the next start, and keeps it after a second rename; an owner signed in through a provider the operator module supplies with `verifies: { label: "Acme SSO" }` shows that label, one through a provider without `verifies` shows no verifier ("name not verified") | `vitest --project integration signin-facts.test.ts -t "renamed"`, `-t "operator module supplies"`; `prove-seeds.ts --only MT-03 --name "5:"` | 2 tests pass; 4 seeds red (the configuration's verifier read now, as before; no verifier recorded; older identities never filled; a module provider's `verifies` ignored), then green |
| 6. A home's held bytes | verified | A home that pushes a version with files of its own reports a higher `bytes.held` in a later window; after `ServerHandle.remove` of that route a later window reports less; `bytes.stored` still sums the uploads. Unit: the level repeats in every window, falls with what is held, says 0 once for a home that holds nothing any more, then nothing | `vitest --project integration operator.test.ts -t "bytes a home holds"`; `vitest --project unit metering.test.ts`; `prove-seeds.ts --only MT-03 --name "6:"` | pass; 3 seeds red (no `bytes.held`, no 0 for an emptied home, no size recorded by either the upload or the push), then green. The first version of the size seed stayed green because the push's commit records a size the upload left out; the seed now removes both |
| 7. Organization-owned homes (design) | brought to Mirza | The design, its eight questions and a recommendation for each, the package it names (WP-33) | [rounds/MT-03-ORGANIZATION-HOMES.md](../design/rounds/MT-03-ORGANIZATION-HOMES.md) | Waiting on Mirza's decision, recorded then as its own entry |
| 9. The pushed version in `limits`' query | verified | A first push whose client files are new to the home takes two rounds (`missing`, then `complete`), and every `version.push` and `storage` ask of it names the version's ID, `storage` with its bytes; a second version's push names its own | `vitest --project integration operator.test.ts -t "names the version being pushed"`; `prove-seeds.ts --only MT-03 --name "9:"` | pass; 1 seed red, then green |

The two RM-04 seeds whose anchors the relay's change moved ("a link floods its relayed actions", "a run past the cap is recorded anyway") are re-anchored to the new code.

## Candidate checks

- **`pnpm check`** on `4e0e12f` in this checkout (49 min 27 s): every job passed but `unit`, which failed the same three property cases as the baseline on their 30 s under the load (`gc.test.ts`'s two VR-06 cases, `interaction.test.ts`'s fields property); both files passed alone at once, with `hosted-relay.test.ts` (57 of 57).
- **CI** on #144 (run 43210610540 on `4e0e12f`, the affected legs on Linux, macOS and Windows x64): every job passed but `e2e (windows-x64, firefox, 1/2)`, whose `client.spec.ts:82` left the shell's Submit on "Submitting…" (#95's class, in code MT-03 doesn't touch; recorded there); it passed on its re-run, and `ci-ok` is green.
- **The seeds:** all 18 of MT-03 (`prove-seeds.ts --only MT-03`) red when planted and green when restored, the held-size seed after it was made to remove both paths; the two re-anchored RM-04 seeds red, then green; `prove-seeds.ts --anchors` plants all 727.

## Reviews (D80, D144)

- **The session's own review** of its diff: the held-size seed stayed green at first (the push's commit fills a size the upload left out), so the seed now removes both; no defect in the code.
- **GPT-6.1-Sol** (`codex review`): blocked. This machine's Codex sign-in has expired (`refresh_token_reused`, as at WP-31), so no review ran and no tokens were spent; it needs `codex login` by Mirza.
- **Claude Opus 5.5** (D144): the prompt is ready for Mirza to run.
- **Copilot:** no review was posted on #144.

## Untested boundaries

- **Real providers.** GitHub's counts and an OpenID Connect provider's claims were checked against local fakes built to the providers' documented answers; GitHub's real `GET /user` was read once for the fields' presence and types (`gh api user`), but no sign-in ran through real GitHub or Google, and the test deployment still runs 0.11.0 (D167 item 20).
- **`bytes.held` after a restart.** The meter keeps which homes it last reported in memory, so a home whose last bytes were removed while the server was down never says 0; it is simply absent from later windows.
- **Windows** runs the new suites in `windows-remote` in CI; they were written and run locally on macOS.

## Deviations

- **Idle expiry** is judged from the link's last view rather than either of the two ways the request suggested (at the session exchange, or leaving the asking session out); both leave an idle link open to a returning browser (D169 item 3).
- **The verifier** is recorded at every sign-in through the identity, not only when it is first linked, so a relabelled provider reaches its people's names at their next sign-in (D169 item 6).
- **The specification's request numbering** skips 8 (the hosted header's phone layout, which belongs to the design pass on the hosted surfaces).

## Agent-facing prose for review (D149)

- Diagnostic docs: `MOSTRA_REMOTE_QUEUE_FULL`'s explanation and fix (an operator's `run.wait` refusal, `Retry-After`).
- The self-hosting page (`docs/reference/self-hosting.md`): the `identityProviders` row (`claims`, the recorded verifier).
- The `AGENTS.md` of `@mostra/runtime` (relayed actions under `limits`, the recorded verifier) and `@mostra/protocol` (the operator subpath's additions).
