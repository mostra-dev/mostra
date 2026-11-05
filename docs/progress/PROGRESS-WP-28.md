# WP-28 progress: the remote design pass

**Status:** In progress. Owns RM-05 ([specification](../design/work-packages/WP-28.md)). This package writes design, not code.

## Baseline

| | |
|---|---|
| Branch | `wp/28-remote-design`, created from `origin/main` |
| Starting `HEAD` | `821322e` (`origin/main`, 2026-11-05: "docs: WP-15's closeout, Mostra 0.9.0, WP-28 next (#125)") |
| `git status` | clean |
| `pnpm check` | green on `821322e` in a detached worktree on the external `Active` disk (macOS 26.2 arm64, Node 24.22.1, pnpm 12.14.0). The first full run (2,331 s) failed only `unit`, in three packages, from causes outside the code: the system disk filled during the run, so `@mostra/sdk`'s bundle tests met their own free-space check (`MOSTRA_ENV_BUNDLE_DOWNLOAD_FAILED`, "0.4 GiB is free"), and two runtime property tests and one React seam test passed their 30 s and 60 s limits on the loaded machine. Once space was freed, `pnpm check --job unit` re-ran the three packages (Turbo cache misses) and passed. Every other job passed in the first run |
| Predecessors | WP-15 done ([PROGRESS-WP-15](PROGRESS-WP-15.md) on `origin/main`), released as Mostra 0.9.0; no `RECOVERY-WP-28-*.md` |
| Milestone `WP-28` | empty; #39, #46, #55, #85, #95, #111 and #124 stay on no milestone (D155 item 7), and #106 waits for the package that takes it |

## Decisions

- **Question set** (2026-11-05T00:39Z): the fourteen questions of the specification, the infrastructure questions and the CLI names, each with options and a recommendation, given to Mirza in one set.
- **M56** (2026-11-05T02:08:17.505Z): "Go with your recommendations, with the changes and additions below." Recorded as **D165**, one entry naming what it amends: D81 for hosted homes (item 0b), IN-13 for hosted links (item 1a), D117's offline states (item 4).
- **Written into the dossier:** ARCHITECTURE §15 (new; the seed's resolution table moves to §16), INTERFACES §18 (new) with pointers from §1, §2.2, §2.3, §4, §6, §7, §9, §12 and §13, DATA_MODEL §3, §4 and §7, FAILURE_MODEL §11, PRODUCT's vocabulary and J10, REPO_STANDARDS §3 (the runtime modules `link` and `server`; `server` may import `@mostra/mcp`), REQUIREMENTS (IN-13 and RM-04 amended; RM-07 to RM-09 added), WORK_PACKAGES' WP-29 and WP-30, and `tools/design/wp_specs.py`'s WP-29, WP-30 and WP-31 detail, regenerated.

## Reviews (D80, D144)

- **My review of the full diff** found, while writing: one tally reference pointing at the wrong section, an operator-pause code borrowed from limits (`MOSTRA_REMOTE_PAUSED_BY_OPERATOR` instead), a manifest note and the §4 refusal list missing `hosted.*` and the tally, and Safari's ephemeral third-party storage once a public-suffix entry makes frames cross-site (a FAILURE_MODEL row). All fixed before the reviews.
- **GPT:** skipped at Mirza's word (2026-11-05: "We can skip GPT"), since GPT-6.1-Sol isn't offered to this Codex account and he dismissed gpt-6-luna as a reviewer at WP-15.
- **Claude Opus 5.5** (D144), run by Mirza on 2026-11-05 against `94e69e7` (Anthropic, run by Mirza, D34): 27 findings, five P1, thirteen P2, nine P3. Every one is fixed in the documents in `b05335c`, and recorded under D165 as "Refined after the Claude Opus review of WP-28":
  1. (P1) An artifact ID is copied with its source, so it can't be a global address: the server now mints a hosted route per (home, artifact) with a random `rte_` ID and label, routes are keyed by home and artifact, and every issued label is recorded forever (DATA_MODEL `artifact_route`, `label_issued`; INTERFACES §18.4).
  2. (P1) Deliveries went to every linked instance: a hosted submission's one delivery owner is now its artifact's owner link, `HomeConfig.ports` is kept per link, and the follow imports only owned artifacts.
  3. (P1) A relayed run that may have happened could end `failed`: the hosted home records `accepted_at`, only a never-sent run can end `owner-offline`, an unacknowledged one is resent and becomes `unknown` at its limit, `port/relay.reconcile` runs after every reconnect, and the owner's `relayMark` detects a home restored to before runs it accepted. The window left (an acknowledgement lost just before a restore to an earlier backup) is stated in FAILURE_MODEL §11.1 as the relay's one accepted boundary.
  4. (P1) A restored hosted home reused cursors: each hosted home has an incarnation, rotated on a restore (`ServerHandle.restored`, or a head below the recorded high-water cursor); the owner dedupes on (incarnation, cursor), continues after the restored head and records `remote.regressed`; FAILURE_MODEL states the loss window.
  5. (P1) No consent step: the authorization server shows its own consent per (account, client), never skipped because a provider skipped its own; the device page warns, and a new link is the event `instance.linked`.
  6. to 18. (P2) Anonymous keys per route (HMAC of one browser secret); sign-in only from the trusted chrome, naming the sender, with `state` bound to route and session; the shell's CSP, Trusted Types, text-only tenant strings and per-route sessions; the shell surviving a full storage group (Firefox's per-site group verified, VERIFIED_FACTS); per-home file presence, uploads only for a pending push, counted references and a grace sweep; closing a binding at its token's expiry unless refreshed in band (`remote/token`), and within 60 s of a revocation; a 30 s refresh grace; Client ID Metadata Documents fetched only from public addresses, without redirects, bounded; `hosted.*` with its defaults (already in INTERFACES §2.2, restated); the instance's link ID kept across `logout`; imported submissions' local delivery IDs derived from (submission, host owner); IPv6 per /64 and `X-Forwarded-For` read from the right; and the operator surface's gaps (`authenticate` on `/host`, `/mcp` and `/files`, `events.deliver`'s payloads, `revokeLink`, `drainHome`, `releaseHome`, `restored`, an idle expiry).
  19. to 27. (P3) Locks as one-row SQLite databases in exclusive locking; `wal_autocheckpoint` as a setting; the offline limit's two clocks and cancelling a never-sent run; a JSON-RPC heartbeat beside the pings; a tally's `minTotal`; `scopes_supported` on the protected resource, loopback port matching, removing unused clients; `MOSTRA_ACTION_PAUSED` and the owning instance's name in `MOSTRA_REMOTE_NOT_OWNER_INSTANCE`; chat-host policy in configuration with an operator override; `frame-ancestors` on every label document; and WP-29's size (its risks name the tally as the piece to move if it runs long).

  The new checks are in the evidence checks of RM-02, RM-03, RM-04, RM-08, HY-08, HY-09, HO-09 and MC-04, and in WP-29's and WP-30's specifications (WP-30's adversarial suite).
- **Claude Opus 5.5, second round** (D144), run by Mirza on 2026-11-05 against `0a6dab4`: all 27 first-round findings addressed, 25 completely; one new P1, three P2 and five P3, each fixed in the documents and recorded under D165 as "Refined after the second Claude Opus review":
  1. (P1) The operator's server handle and the ports named artifacts and versions by IDs that repeat across homes since round 1's routes (a copied project keeps its artifact ID, so an identical version keeps its version ID): every handle target names a route (`{ routeId }`, `{ routeId, versionId }`), `abuse`, `policy` and `events` carry `routeId`, the quarantine table is route-scoped, and WP-30's adversarial suite seeds two homes hosting one artifact ID with identical versions.
  2. (P2) The session exchange's `browser` field still sent the raw browser secret to every home: on a hosted shell it is the route's derived key, the raw secret never leaves storage, and HY-08's check covers every body and header.
  3. (P2) Restore detection relied on a high-water mark a whole-directory restore rolls back too: the owner instance is the witness (its committed cursor and relay mark in `mostra/initialize`, checked before the home answers it), `mostra-runtime server --restored` serves self-hosters, `home_cursor`'s write points are stated, relay sequences continue above the owner's mark, an update for a run the restored home no longer knows is dropped and logged, and a viewer resuming above the head gets a fresh snapshot.
  4. (P2) `home_file`'s wording let a pending push's listing claim bytes: a row exists only from an upload or a complete version.
  5. to 9. (P3) `hosted_artifact` keyed by (artifact, server); relay sequences unique per owner link; `logout`'s `--forget` in the CLI section; reconciling before the waiting runs drain; a quarantine never reaches an identical version in another home.

## Evidence

| ID | State | Check | Command | Result |
|---|---|---|---|---|
| RM-05 | unverified | Mirza accepts the design; the generators pass with the refined WP-29 and WP-30 specifications | `python3 tools/design/wp_specs.py`, `python3 tools/design/evidence_matrix.py --check` | pending |
