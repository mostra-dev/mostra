# Changesets

Every user-visible change to a published package carries a changeset (REPO_STANDARDS §7). Run
`pnpm changeset`, pick the packages and the bump, and describe the change for the changelog.
Packages stay at 0.x until the host protocol freezes, so a breaking change is a minor bump.

`pnpm check` (job `api`) fails when a package's API report changes without a changeset naming it.
