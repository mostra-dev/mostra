# MT-05 progress: who signs in, and what an idle home writes

**Status:** Candidate, in progress. A maintenance unit beside WP-17 and MT-04 ([specification](../design/work-packages/MT-05.md)); it owns no requirement of its own, and the checks it adds extend MC-04's (the consent page), HY-08's (sign-in's identity) and RM-03's (the self-hosted server and its backups) rows. Its decision is D176, approved at M76 with its words. Its scope is the GitHub milestone `MT-05`: #168, #171 and #186.

## Baseline

| | |
|---|---|
| Branch | `mt/05-sign-in`, created from `origin/main` |
| Starting `HEAD` | `8165633` (`origin/main`, 2026-11-16: "docs: the test deployment is retired; candidates are checked on the hosted service (#170)") |
| `git status` | clean |
| `pnpm check` | on `8165633` in a detached worktree (`temp/mt05/baseline`, git-ignored) after a fresh `pnpm install --frozen-lockfile`, 137 min while this session's own seeds and suites ran beside it: format-lint, types, hygiene, build, boundaries, api, licenses, conformance, docs and commits passed; unit, integration and e2e failed on time limits under that load (the class MT-02, WP-30, MT-03 and WP-16 recorded: `gc.test.ts`, the interaction properties, React's seams, the tools' gate seeds, Firefox's e2e legs), and rust failed two `mostra-host::bundle` cases whose bundle setup exits 1 on this machine (below). The real baseline is CI's: the merge-queue run 43851835167 on `8165633`, green |
| Predecessors | Nothing unreleased (Mostra 0.15.1 on `main`); no `RECOVERY-MT-05-*.md` |
| Beside it | WP-17 (#185, which takes D175 and M74, so this unit's are D176, M75 and M76) and MT-04 |
| Local toolchain | Node 24.22.1 (`.node-version`, through fnm), pnpm 12.14.0, macOS 26.2 arm64; the checkout, its pnpm store and `TMPDIR` on the external disk |

## Decisions

- **M75** (2026-11-16T18:40:49Z): Mirza started the unit with the assignment prompt and its specification.
- **M76** (2026-11-16T20:49:32Z): Mirza approved the session's questions (the amendment of DATA_MODEL §7.1 and D166 item 14, the consent page's "this server's own app", GitHub's public address kept unflagged when no verified primary is listed, D176's number), delegated the rest, and approved the external checks and the operating layer's follow-up.
- **D176** (approved at M76): `operatorClients`; GitHub's `user:email` and verified primary address; an open home's marks written only when they moved.

## What was built

| Part | Where | What it does |
|---|---|---|
| The plan | `docs/design/WORK_PACKAGES.md`, `tools/design/wp_specs.py`, `work-packages/MT-05.md` | MT-05 in the order, beside any package, with its specification generated |
| Idle marks (#186) | `packages/runtime/src/server/data.ts` | A tick writes `home_cursor` only when the row doesn't hold the home's incarnation, head and relay mark; opening and closing write as before. `MOSTRA_TEST_CURSOR_MARK_MS` shortens the tick for tests |
| GitHub's address (#171) | `packages/runtime/src/server/providers.ts` | `scope=user:email`; `GET /user/emails?per_page=100` beside `GET /user`, in API version `2022-11-28`; the `primary` and `verified` entry as `email` with `emailVerified: true`; a declined scope (the token's `scope`), a refused or malformed list, or one slower than 3 s gives no verified address and never fails the sign-in |
| Operator clients (#168) | `packages/runtime/src/server/config.ts`, `oauth-clients.ts`, `pages.ts`, `index.ts` | `operatorClients: [{ clientId, name }]` (1 to 16, `clientId` a metadata document's `https:` URL in normal form, `name` as `appearance.name`, none twice); such a client, fetched and checked as any other, is named on the consent page by its configured name with "this server's own app"; consent once per account as for any client |
| Tests | `test/unit/data-marks.test.ts`, `test/integration/idle-marks.test.ts` (group `remote`, and `windows-remote` on Windows), cases in `signin-facts.test.ts`, `oauth.test.ts`, `server-config.test.ts`; the fake GitHub models granted scopes and the address list; `tests/e2e/specs/surfaces.spec.ts` photographs the new consent state (`api-allow-own`) | below |
| Dossier and docs | D176, INTERFACES §18.1 and §18.5, DATA_MODEL §7.1, D166 item 14's amendment, VERIFIED_FACTS (MT-05), the self-hosting page, the runtime's `AGENTS.md`, `.changeset/mt05-sign-in.md` | |

## Evidence

MT-05 owns no requirement (D152): one row per item of its scope, each checked through the real interface (a real `mostra-runtime server`, its fake GitHub and a metadata-document server on loopback, real owner daemons, pages through the real front and gateway), with seeded violations (`node packages/runtime/scripts/prove-seeds.ts --only MT-05`) red when planted and green when restored.

| Item | State | Check | Command | Result |
|---|---|---|---|---|
| 11. An operator's own clients on the consent page (#168) | verified | With `operatorClients` naming a metadata-document client "Example Cloud account" whose document names itself otherwise, a person signing in meets "Allow Example Cloud account?" and "**Example Cloud account** (this server's own app)", neither "not checked" nor the document's own name; once approved, the next authorization of that account goes straight back with a code; another account is asked for itself; another metadata-document client, though it calls itself by the same name, still reads "(a name the app gives itself, not checked)". The configuration takes 1 to 16 entries and refuses an `http:` URL, one without a path, with a fragment, not in its normal form (`https://Account.Example/…`, `…/a/../c.json`), a registered client's ID, an empty, over-long or bidirectionally overridden name, a missing name, an unknown key and a client named twice, each with `MOSTRA_REMOTE_CONFIG_INVALID` naming the key. The page in Chromium at 1280 and 390 px, light and dark, axe clean | `vitest --project integration oauth.test.ts -t "operator's own client"`; `vitest --project unit server-config.test.ts`; `playwright test specs/surfaces.spec.ts` (`MOSTRA_E2E_BROWSER=chromium`); `prove-seeds.ts --only MT-05 --name "11:"` | 8 + 6 tests pass; surfaces 5 of 5 in Chromium; 4 seeds red, then green (the document's own name shown unverified; the operator's client skipping consent; a non-normal client ID taken; one client named twice) |
| 12. GitHub's verified address (#171) | validated | A GitHub sign-in asks for `scope=user:email`; with an address list holding a verified no-reply address, an unverified old one and the private, verified primary, `accounts.resolve` receives the primary with `emailVerified: true`, the list read once with `per_page=100` in version `2022-11-28`; an unverified primary gives none, or the public address unflagged when there is one; a declined scope (the token's `scope` empty) never asks for the list and signs in with the public address; a list answering 502 signs in with the public address; a list that never answers signs in within its 3 s, under 7 s in all. External: GitHub answers a token without the scope with 404 and `X-Accepted-OAuth-Scopes: user, user:email`; an account that had signed in through the staging deployment's GitHub app with no scope was shown GitHub's authorization page again for `user:email` (VERIFIED_FACTS, MT-05) | `vitest --project integration signin-facts.test.ts -t "GitHub"`; `prove-seeds.ts --only MT-05 --name "12:"`; `gh api -i user/emails`; GitHub's authorization page (external) | 3 tests pass; 6 seeds red, then green (no scope asked; the first verified address taken; an unverified primary taken; the list asked for though declined; a failing list failing the sign-in; a hanging list holding it). A real sign-in carrying a real private address runs in the operating layer's follow-up on staging (Untested boundaries) |
| 13. What an idle home writes (#186) | verified | With an owner linked and its page shared, 30 ticks with nothing happening make no commit to the server's directory (`PRAGMA data_version` from a read-only connection, as a WAL replicator reads it) and leave `home_cursor` as it was; a submission moves the head and a relayed run the relay mark, and the next tick writes each; the directory is quiet again after; at the server's stop the row holds the home's marks. Unit, over a real data directory: an incarnation the home took while open, and a head that moved, are each written at the next tick and only once; the closing write records marks no tick wrote. Measured at the real 10 s tick, 75 s with an owner linked and nothing happening: before, 7 directory commits, all `home_cursor`, none in the home's ledger; after, none (with the fixture operator module and a viewer's page open, one commit, the operator's held-bytes level at its first window after the start). A restore still rotates the incarnation (`binding.test.ts`, `restore.test.ts`) | `vitest --project integration idle-marks.test.ts`; `vitest --project unit data-marks.test.ts`; `vitest --project integration binding.test.ts -t "rotates"`; `restore.test.ts`; `prove-seeds.ts --only MT-05 --name "13:"` | 3 + 4 tests pass; 3 seeds red, then green (every tick writing; an incarnation left unwritten; a moved head left unwritten) |

## Candidate checks

- **`pnpm check`** on `de2043b` (the candidate with `main` merged in, `d186690`), in this checkout with nothing else running, 83 min: format-lint, types, integration, hygiene, e2e, build, boundaries, api, licenses, conformance, docs and commits passed. `unit` failed time limits only, each file passing alone at once (`gc.test.ts` and `interaction.test.ts` 46 of 46; React's `seams.test.ts` and `hooks.test.tsx` 18 of 18; the CLI's `telemetry.test.ts` 35 of 35, #129's install-ID case; the worker's `index.test.ts` 9 of 9; the tools' Rust gate seeds, as in every recent baseline). `rust` failed the same two `mostra-host::bundle` cases as the baseline (`a_pinned_bundle_installs_once_into_the_digest_keyed_cache`: "The bundle's setup failed (exit status: 1)"; `an_install_given_up_part_way_holds_nothing_up`), on `main`'s code too, in no path this unit changes; CI's `rust` legs pass them.
- **CI** on #190: run 43952081417 (before the merge with `main`) passed `static`, `unit`, `hygiene`, `rust`, `conformance`, every e2e leg and the release rehearsal before a push cancelled it; run 43959226847 (on `de2043b`) passed every job but `integration (macos, verify-failures)`, which GitHub never started ("The job was not acquired by Runner of type hosted even after multiple attempts": macOS capacity).

## Untested boundaries

- **A real GitHub sign-in through the candidate** carrying a real private, verified address: the adapter was checked against a fake built to GitHub's documented and observed answers; the real sign-in runs on staging in the operating layer's follow-up, once the release is out.
- **GitHub's exact words** for the scope on its authorization page: the page was shown and approved, but no screenshot was kept (the session couldn't capture the screen).

## Agent-facing prose for review (D149)

- The consent page's "this server's own app" (approved at M76).
- The self-hosting page's `identityProviders` and `operatorClients` rows.
- The runtime's `AGENTS.md`: the remote-server invariant's two sentences and the `MOSTRA_TEST_CURSOR_MARK_MS` hook.
- The changeset's release notes, which name GitHub's consent screen.
