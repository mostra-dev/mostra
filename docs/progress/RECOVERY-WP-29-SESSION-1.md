# WP-29 recovery handoff, session 1

**Written:** 2026-11-05, during session 1, as a checkpoint while the package is still being built. Session 1 continues after it; a later session that finds this file resumes from **Next action**, after reading the specification, D165 and D166.

## Git state

- Branch `wp/29-remote-relay` (draft pull request #128), pushed; `HEAD` `bb061a2`, from `origin/main` `a6f974f`.
- Commits so far (oldest first): `9b80688`, `a0e26ec` (the report's baseline), `955ab35` (RM-07 tally), `b9e6780` (#119), `eec2d62` (RM-01 bundle), `a76751c` (#114, #118, #116's Skill section), `09ebb64` (the server's core), `5227473` (protocol modules for the bridge budget), `bb061a2` (sign-in, binding, `hosted/push`).
- Working tree clean at `bb061a2`. Logs of local runs are in `/Volumes/Active/wp29-logs/`.

## Done, with evidence (local)

| ID | Built | Checks (local; seeds red then green with `node packages/runtime/scripts/prove-seeds.ts --only <ID>`) |
|---|---|---|
| RM-07 | manifest `tally` with `manifestProblem`, migration 12's `tally` table with its triggers, counting in the submit transaction, `$tally/<field>` on the live channel (`stateOf` and `onTallied`), `live/push` refusing tally keys, `TallyKey`/`TallyValue` in `@mostra/react`, the Skill's "Counts by choice" | `test/unit/tally.test.ts` (300 submissions over 3 choices, outside choices count nothing, `minTotal`, pushed to a watching view with no worker, triggers refuse decrease/delete/replace); 5 seeds. **Missing:** the hosted half (a hosted home counts too: the hosted home reuses the interaction core, so it needs only its live read path once hosted pages exist) |
| RM-01 | `artifact/export`, `artifact/import`, `mostra export`, `mostra run`, `publish/bundle.ts` | `test/integration/bundle.test.ts` (4), CLI contract case, MCP statelessness test; 3 seeds. **Missing:** a bundle whose lockfile has on-demand packages a fresh home's store lacks |
| RM-02 (part) | `mostra-runtime server` (data directory, `server.lock`, `home.lock`, normal-locking ledgers, network-filesystem refusal, Host routing, cookies dropped), the device grant and development provider, the WebSocket binding (heartbeat, limits, `remote/token`, revocation close), `hosted/push` and `/files` | `server.test.ts` (7), `binding.test.ts` (5), `heartbeat.test.ts` (1, real 60 s proxy and 45 s silence); 11 seeds |
| #114, #118, #119 | fixed with tests and seeds | contract J1, shell model and e2e, `actions.test.ts` "119" |
| #116 | the Skill's "Approvals that do something" | no example artifact yet |

`pnpm check`'s static jobs, unit and integration were green locally at `bb061a2`.

## Missing (the rest of the specification)

1. **The owner's link on the instance** (`packages/runtime/src/link/`): the link manager (refresh token in `<home>/keys/remote/<server hash>.json`, `remote_link`, `hosted_artifact`, `version_push`, `relayed_run` tables appended to migration 13, which is unreleased), `remote/login|login.wait|logout|status` handlers, the binding with refresh, the `submissions` port importing a hosted submission and enqueuing the local outbox in one transaction (FK finding below), the sync cursor (`events/subscribe` named `owner:<lnk>`, events copied with `origin`), forwarded `state/patch` and `live/push`, pushes of later publishes, `share/start { via: "remote" }`.
2. **Hosted pages**: the gateway in a hosted mode on the server's one listener (routing by label and apex, header sessions `X-Mostra-Shell`, worker-mode frames, `/a/<routeId>` paths), hosted links (`view/url` on a hosted home, `link_domain`), the shell's "Your answer was sent." and no delivery state for respondents.
3. **The relay**: migration for `action_run`'s `unknown` (a table rebuild), `relay_run`, `port/relay.*` and `relay/*`, waiting runs, the offline policy and limit's two clocks, the capped queue and drain, reconcile, `ownerUnreachable`, live producers, effects, the secrets grep over relay traffic.
4. **Restore**: incarnation rotation (`--restored`, owner as witness, `home_cursor`), Litestream reading a live hosted ledger, `remote.regressed`, the 250 ms open-time measurement.
5. **CLI**: `login`, `logout`, `share --cloud`, cloud shares in `share list`/`stop`, links in `status`, the default-instance command; help text for Mirza.
6. **Conformance** remote scenarios; the Skill's sharing reference for servers; docs.
7. **Prove**: the evidence table, GPT and Claude Opus reviews (D80, D144), `pnpm check`, the evidence matrix, Windows legs (CI).

## Findings to bring Mirza

- **Imported submissions and the ledger's foreign keys.** `submission` references `view`, `viewer` and `document` and is unique on `(artifact_id, scope_key, epoch)`. An imported hosted submission therefore needs local rows for its hosted view and viewer (DATA_MODEL §7.3 names only viewers) and a scope key apart from the owner's local links (a `once` per-artifact local submission and a hosted one would otherwise collide). Proposal: import the view and viewer rows under the hosted IDs, and prefix an imported submission's `scope_key` with its origin; record it in D166 and DATA_MODEL §7.3.
- **Questions not yet asked** (each with a recommendation): the default server when none is configured (none in the open repository: `mostra login <server>` names it, and the last signed-in server is the default after); the command that changes the account's default instance (`mostra login <server> --default`); external evidence against a deployed server (WP-30's test deployment, labelled external, as an accepted boundary for WP-29).
- **The protocol's whole-entry size budget** rose from 54 to 60 kB for the remote methods (the browser entries stay within their own budgets: the bridge moved durations and the submission policy into modules of their own).

## Next action

Build item 1 (the owner's link on the instance) with the submission import, test it in-process against `startServer` and a real instance, then item 2 (hosted pages) so a browser can submit, which closes RM-02's main path.
