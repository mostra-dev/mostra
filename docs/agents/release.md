# Release Mostra

Use after Mirza accepts a work package, whose acceptance authorizes publishing it (D36). One
release publishes every package of the fixed release group at one version, the four runtime
bundles, their `SHA256SUMS` and attestations, and (once a crate is publishable) the crates
(EN-05, D67, `.github/workflows/release.yml`).

1. **The package is merged.** Its changesets are on `main`, and `main`'s `Release` workflow run is
   green: every bundle built, audited and smoke-tested with no Node.js, every package packed and
   dry-run published, and the npm path smoke-tested on Node.js 22. Don't release a red `main`.
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
   `pnpm changeset version`, then `node tools/release/versions.ts sync` (the host crate takes the
   group's version; Changesets knows nothing of Cargo, and repo lint refuses a crate that differs),
   then `pnpm install` (the lockfile takes the new versions), then `pnpm check --affected`. Commit `chore(release): Mostra <version>` with `git commit -s`, push,
   and open the pull request with the version's changelog. Every package of the group and the host crate move
   to one version; nothing else changes. Before this pull request, every pull request's `Release`
   run rehearses the version its pending changesets make (`versions.ts plan` and `rehearse`):
   npm refuses even a dry run over a version it has.
4. **Merge it when CI is green.** On `main` the `Release` workflow's `plan` job
   (`packages/bundle/scripts/github-release.ts state`) sees a version with no changeset pending
   and no published release, and the `publish` job runs in the `release` environment (only `main`
   may deploy there, one run at a time). In this order: it attests the bundles; publishes the
   GitHub release `v<version>` with the four archives, their asset records and `SHA256SUMS`
   (immutable from then on); checks from outside that the release holds exactly those bytes and
   that each pinned URL downloads; and only then publishes the npm packages with provenance. So
   the `@mostra/sdk` npm serves always pins archives that exist.
5. **A failure part-way** finishes by itself, never by hand:
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
6. **Check it from outside** (external evidence for the progress report):
   - `npm view @mostra/cli@<version> dist.attestations` names a provenance attestation, and
     `npm audit signatures` in a project that installed it verifies;
   - `gh release view v<version>` lists four `mostra-<version>-<platform>.tar.gz`, their `.json`
     asset records and `SHA256SUMS`;
     `gh attestation verify <archive> --repo mostra-dev/mostra` passes for one of them;
   - on a clean machine, `npm create mostra@latest my-artifact`, then
     `npx @mostra/cli verify my-artifact` and `npx @mostra/cli publish my-artifact`.

**Done when** the `publish` job is green, the release is published with its nine assets, every
package of the group shows `<version>` on npm with provenance, and the clean-machine check passed.
