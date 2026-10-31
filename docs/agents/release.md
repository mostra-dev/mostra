# Release Mostra

Use after Mirza accepts a work package, whose acceptance authorizes publishing it (D36). One
release publishes every package of the fixed release group at one version, the six runtime
bundles, their `SHA256SUMS` and attestations, and (once a crate is publishable) the crates
(EN-05, D67, `.github/workflows/release.yml`).

1. **The package is merged.** Its changesets are on `main`, merged through the merge queue, whose
   `CI` run of the merge group was green, its release rehearsal included (`release-build.yml`):
   every bundle built, audited and smoke-tested with no Node.js, every package packed and dry-run
   published, and the npm path smoke-tested on Node.js 22. `main` itself runs no rehearsal (D152);
   the nightly `CI` run checks it whole. Don't release from a `main` whose nightly is red.
2. **The first release only: Mirza's account steps.** He runs `tools/release/npm-setup.sh` in a
   terminal (signed in to npm as an owner of `@mostra` and `create-mostra`, 2FA on). It
   authenticates once (he chooses "skip two-factor authentication for the next 5 minutes"), then
   for each package publishes a placeholder if it's new, configures its trusted publisher
   (`mostra-dev/mostra`, `release.yml`, environment `release`, direct publish), checks npm now
   reports exactly that, and sets "Require two-factor authentication and disallow tokens". It stops
   on anything npm doesn't answer clearly, and can simply be run again; it ends with "Done: every
   package has its trusted publisher". Each configuration expires unless it publishes within 2
   days, so the release runs right after. `--check` reports the state without changing anything
   (it reads "unreadable EOTP" where npm wants a second factor).
3. **Open the version pull request.** From the new `origin/main`, on a branch `release/v<version>`:
   `GITHUB_TOKEN=$(gh auth token) pnpm changeset version` (the changelog names each change's pull
   request through GitHub's API), then `node tools/release/versions.ts sync` (the host crate and the
   Agent Skill's `@mostra/cli@<version>` pins take the group's version; Changesets knows nothing of
   Cargo or the Skill, and repo lint refuses a crate or a pin that differs),
   then `pnpm install` (the lockfile takes the new versions), then `pnpm check --affected`.
   Commit `chore(release): Mostra <version>` with `git commit -s`, push, and open the pull request
   with the version's changelog. Every package of the group, the host crate and the Skill's pins
   move to one version; nothing else changes. Before this pull request, `CI`'s release rehearsal rehearses
   the version its pending changesets make (`versions.ts plan` and `rehearse`), or the next patch
   when none is pending and npm already has the tree's version (#69): npm refuses even a dry run
   over a version it has. The version pull request itself rehearses its own version.
4. **Merge it through the merge queue when CI is green.** On `main` the `Release` workflow's `plan` job
   (`packages/bundle/scripts/github-release.ts state`) sees a version with no changeset pending
   and no published release, and the `publish` job runs in the `release` environment (only `main`
   may deploy there, one run at a time). In this order: it attests the bundles; publishes the
   GitHub release `v<version>` with the six archives, their asset records and `SHA256SUMS`
   (immutable from then on); checks from outside that the release holds exactly those bytes and
   that each pinned URL downloads; then publishes the npm packages with provenance; and last the
   crates, from the release's tag with the same pins as `@mostra/sdk`
   (`crates/mostra-host/bundles.json`, which the crate's build embeds and refuses for another
   version), through crates.io trusted publishing (`tools/release/crates.ts plan` names what to
   publish). So the `@mostra/sdk` npm and the crate always pin archives that exist. Then the
   harness plugin, in two jobs so its deploy key never meets installed code: `plugin-build` builds
   and checks it from the release's tag (`tools/plugins/cli.ts build` and `check`, with the
   release's telemetry endpoint, so its README discloses what the CLI sends) and uploads it with
   its SHA-256; `plugin` (the `release` environment, `PLUGIN_DEPLOY_KEY`, nothing installed)
   checks that digest and publishes it to `mostra-dev/mostra-plugin` (`tools/plugins/publish.ts`):
   one commit on `main` tagged `v<version>`, or for a version older than one published already,
   the tag alone on a commit off `main`, which keeps the newest. A re-run is a no-op once the tag
   holds the same tree, and a tag that holds another tree fails the job: a published plugin tag
   never moves. The plan asks for the plugin while its repository lacks this version's tag and
   the tag's source has the generator, so a plugin job that failed after npm finished runs again
   on the next run, whatever npm holds. **The telemetry endpoint** is the repository variable
   `MOSTRA_RELEASE_TELEMETRY_ENDPOINT` (empty, no collector, until the managed service's exists:
   D142 item 11); the plan reads it once and every build of the release takes that value.
5. **A crate's first release only: Mirza's token.** crates.io configures a trusted publisher only
   for a crate that exists, so a crate's first version waits: the `publish` job's summary says
   "First release of mostra-host". Mirza runs `tools/release/crates-setup.sh <version>` in a
   terminal: it publishes the crate from the release's tag with the pins the published
   `@mostra/sdk` carries (checked against the release's `SHA256SUMS`), using a token he pastes
   (scope `publish-new`), then names the two last steps: add the trusted publisher on crates.io
   (`mostra-dev/mostra`, `release.yml`, environment `release`) and revoke the token. Every later
   release publishes the crate itself.
   **The plugin repository, once** (done in WP-14; `node tools/github/settings.ts verify` checks
   it): `mostra-dev/mostra-plugin` exists, public, without issues, with the rulesets of
   `.github/plugin-rulesets` (`main` never rewritten, `v*` tags never moved or deleted); the
   organization allows deploy keys; the repository's one deploy key, `release`, with write access,
   is the public half of `PLUGIN_DEPLOY_KEY`, and that secret is set on the `release` environment
   only. To replace the key:
   `ssh-keygen -t ed25519 -N '' -C mostra-plugin-release -f <scratch>/key`, then
   `gh repo deploy-key add <scratch>/key.pub --repo mostra-dev/mostra-plugin --allow-write --title release`
   and `gh secret set PLUGIN_DEPLOY_KEY --env release --repo mostra-dev/mostra < <scratch>/key`,
   then remove the old key (`gh repo deploy-key delete <id> --repo mostra-dev/mostra-plugin`) and
   delete the scratch key. Submitting the plugin to a directory is Mirza's (D147).
6. **A failure part-way** finishes by itself, never by hand:
   - **Before the release is published** (a draft, nothing on npm): re-run the failed jobs, or let
     the next push to `main` run; the draft's assets are replaced by that run's, since nothing
     published names them yet.
   - **After the release is published, with npm incomplete:** re-run the failed jobs, or let the
     next push to `main` run. `plan` reports `finish`: the run builds every package from the
     release's tag, pins the release's own archives (never a new build), smoke-tests them, and
     publishes only what npm lacks. A package npm already has is skipped only when npm holds
     exactly that tarball; anything else fails the run before a byte is published.
   - **npm has the version but the release isn't published** can't happen in this order; `plan`
     fails closed. Look before publishing anything by hand.

   - **npm refused a publish with 404** right after "Signed provenance statement": no trusted
     publisher matched (the job prints npm's `oidc` lines). Mirza runs `npm-setup.sh` again, then
     the failed `publish` job is re-run: the published release is kept and npm is finished.

   Never delete a tag or a published release: both are immutable (the release-tags ruleset,
   immutable releases); a release that can't be finished is replaced by the next version.
7. **Check it from outside** (external evidence for the progress report):
   - `npm view @mostra/cli@<version> dist.attestations` names a provenance attestation, and
     `npm audit signatures` in a project that installed it verifies;
   - `gh release view v<version>` lists six `mostra-<version>-<platform>.tar.gz`, their `.json`
     asset records and `SHA256SUMS`;
     `gh attestation verify <archive> --repo mostra-dev/mostra` passes for one of them;
   - on a clean machine, `npm create mostra@latest my-artifact`, then
     `npx @mostra/cli verify my-artifact` and `npx @mostra/cli publish my-artifact`;
   - a fresh Rust program depending on `mostra-host = "<version>"` spawns an instance on a fresh
     `MOSTRA_CACHE_DIR`: it downloads, checks and caches the pinned bundle;
   - `git ls-remote https://github.com/mostra-dev/mostra-plugin v<version>` names the tag, and
     `claude plugin validate` passes on a clone of it.

**Done when** the `publish`, `plugin-build` and `plugin` jobs are green, the release is published with its 13 assets, every
package of the group shows `<version>` on npm with provenance, `mostra-host` shows `<version>` on
crates.io, the plugin repository has the tag `v<version>`, and the clean-machine checks passed.
