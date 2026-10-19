# Release Mostra

Use after Mirza accepts a work package, whose acceptance authorizes publishing it (D36). One
release publishes every package of the fixed release group at one version, the four runtime
bundles, their `SHA256SUMS` and attestations, and (once a crate is publishable) the crates
(EN-05, D67, `.github/workflows/release.yml`).

1. **The package is merged.** Its changesets are on `main`, and `main`'s `Release` workflow run is
   green: every bundle built, audited and smoke-tested with no Node.js, every package packed and
   dry-run published, and the npm path smoke-tested on Node.js 22. Don't release a red `main`.
2. **The first release only: Mirza's account steps.** He runs `tools/release/npm-setup.sh` (signed
   in to npm as an owner of `@mostra` and `create-mostra`, 2FA on), which publishes a placeholder
   for each new package, configures its trusted publisher (`mostra-dev/mostra`, `release.yml`,
   environment `release`, direct publish) and sets "Require two-factor authentication and
   disallow tokens". Each configuration expires unless it publishes within 2 days, so the version
   pull request merges right after. `tools/release/npm-setup.sh --check` reports the state.
3. **Open the version pull request.** From the new `origin/main`, on a branch `release/v<version>`:
   `pnpm changeset version`, then `pnpm install` (the lockfile takes the new versions), then
   `pnpm check --affected`. Commit `chore(release): Mostra <version>` with `git commit -s`, push,
   and open the pull request with the version's changelog. Every package of the group moves to
   one version; nothing else changes.
4. **Merge it when CI is green.** On `main` the `Release` workflow sees a version with no changeset
   pending and no `v<version>` tag, and its `publish` job runs in the `release` environment
   (only `main` may deploy there): it attests the bundles, creates the draft GitHub release with
   the bundles and `SHA256SUMS`, publishes the npm packages with provenance, then publishes the
   GitHub release (tag `v<version>`, immutable once published).
5. **A failure part-way** is finished by re-running the failed jobs: a version already on npm is
   skipped and an existing draft release is completed. Never delete a tag or a published
   release: both are immutable (the release-tags ruleset, immutable releases); a broken release is
   fixed by the next version.
6. **Check it from outside** (external evidence for the progress report):
   - `npm view @mostra/cli@<version> dist.attestations` names a provenance attestation, and
     `npm audit signatures` in a project that installed it verifies;
   - `gh release view v<version>` lists four `mostra-<version>-<platform>.tar.gz` and `SHA256SUMS`;
     `gh attestation verify <archive> --repo mostra-dev/mostra` passes for one of them;
   - on a clean machine, `npm create mostra@latest my-artifact`, then
     `npx @mostra/cli verify my-artifact` and `npx @mostra/cli publish my-artifact`.

**Done when** the `publish` job is green, the release is published with its five assets, every
package of the group shows `<version>` on npm with provenance, and the clean-machine check passed.
