# @mostra/bundle

Audience: the runtime bundle's assembler and the release workflow. Runs in: node, on the build
machine and in CI; nothing of it ships. Not published to npm.

## Purpose

What a runtime bundle carries (RT-01, D142), and the scripts that build, check and release it:

- `scripts/build.ts` assembles this platform's bundle. It deploys this package's production
  dependencies hoisted as the bundle's `lib/node_modules`, so every Mostra package sits at
  `lib/node_modules/@mostra/<name>` beside the others (how the runtime finds its worker, verify
  runner, shell and warm set, and how the SDK finds the bundle it sits in). It deploys the warm set
  (`@mostra/warm`) apart, isolated, so artifacts resolve nothing but warm packages, and it unpacks
  the official Node.js checked against `node.json`, which `tools/release/node-pins.ts` writes from
  the release's signed SHA-256 list (`docs/agents/update-node.md`).
- `scripts/smoke.sh` checks an archive, refuses a tampered copy, and runs `new`, `verify` and
  `publish` with no Node.js on `PATH`, then again from a moved bundle; `npm-smoke.sh` and
  `npm-old-node.sh` do the npm path (Node.js 22, and the refusal on 20).
- `scripts/pins.ts` writes `@mostra/sdk`'s `dist/bundles.json` and `SHA256SUMS` from the six
  asset records; `publish-npm.ts` packs and publishes the fixed release group; `notes.ts` writes
  the release notes; `github-release.ts` decides what a release run does and makes and checks the
  GitHub release.

## Invariants it owns

- **The bundle's Mostra packages are exactly these dependencies, plus `@mostra/warm`.** A package
  the bundle must ship goes here; the assembler fails when one of them isn't at the release's
  version.
- **`playwright-core` is listed directly** so it sits at `lib/node_modules/playwright-core`, the
  installer `bundle.json` names for the verify browser, which is never in the archive.
- **The published GitHub release is the one source of truth for a version's bundles.** It is
  published, and checked from outside, before any npm package of its version; a run that finds it
  published only finishes what npm lacks, from its tag's source and its own archives, never a new
  build; a package npm already has is skipped only when npm holds exactly that tarball
  (`github-release.ts`, `publish-npm.ts`, D142 item 9).
- **What the publish job runs imports only `node:` modules** (repo-lint's check): it holds the
  release's OIDC token.

## Public interface

`package.json` `dependencies`, and the scripts' command lines (each documented at its top).

## Tests to run

`pnpm exec node packages/bundle/scripts/build.ts --out <dir>` (through pnpm, which Windows needs), then
`sh packages/bundle/scripts/smoke.sh <archive> <sha256>`; `node tools/license-audit/cli.ts --bundle
<extracted bundle>`; `pnpm --filter @mostra/bundle typecheck`. The release itself is
`docs/agents/release.md`.

## Gotchas

- Adding a dependency here adds it to every bundle; the license audit checks the assembled tree.
- A bundle is built on the platform it is for: its native packages and its browser pin are that
  machine's.
