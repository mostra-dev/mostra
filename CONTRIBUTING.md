# Contributing to Mostra

Thanks for helping. Mostra is Apache-2.0, and contributions are accepted under the
[Developer Certificate of Origin](https://developercertificate.org/) (DCO), not a CLA.

## Sign off every commit

By signing off, you certify the DCO 1.1 below for that commit:

```sh
git commit -s -m "fix(protocol): reject cursors with leading zeros"
```

This adds a `Signed-off-by: Your Name <you@example.com>` trailer that matches the commit's author.
CI rejects a pull request with any commit that lacks one. To sign off commits on your branch that
you haven't pushed yet, run `git rebase --signoff origin/main`.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/) with the package as scope:
`feat(protocol): …`, `fix(runtime): …`, `docs(design): …`, `build: …`. Types: feat, fix, docs,
style, refactor, perf, test, build, ci, chore, revert. One coherent change per commit, with a
factual, imperative subject of at most 100 characters.

## Getting set up

You need, on macOS or Linux:

- Node.js 24 (see `.node-version`) and pnpm, which `packageManager` pins; Corepack or a recent pnpm
  switches to it automatically;
- Rust through rustup (`rust-toolchain.toml` pins the version), with `cargo-nextest` and
  `cargo-deny`;
- Python 3 and rsync, which some repository checks use.

```sh
pnpm install     # also installs the Git hooks (lefthook)
pnpm check       # every CI gate, locally; add --affected to check only what you changed
pnpm fix         # apply formatting and lint autofixes, regenerate references
pnpm gen <name>  # start a package, diagnostic code or protocol method in the right shape
```

`pnpm check` runs the same jobs as CI, so a green local run means a green CI run, apart from the
other systems' legs (macOS, Linux and Windows) and GitHub's hosted scanners.

## Pull requests

- Every user-visible change to a published package carries a changeset: `pnpm changeset`. The API
  gate fails when a package's API report changes without one.
- Fill in the pull request template: the requirement IDs touched, the evidence (checks run, what
  wasn't run and why), screenshots for visible changes, API report changes, and agent-facing prose
  changes.
- Pull requests merge with merge commits after review.

New dependencies are reviewed for maintenance, license and install scripts. Everything Mostra
ships depends only on OSI-licensed code, which the license audit enforces.

## Reporting security problems

See [SECURITY.md](SECURITY.md). Please don't report vulnerabilities in public issues.

## Developer Certificate of Origin 1.1

```text
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.


Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```
