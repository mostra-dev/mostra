# @mostra/bundle

Audience: the runtime bundle's assembler (`scripts/build.ts`). Runs in: nothing; this package has no
code. Not published to npm.

## Purpose

The list of what a runtime bundle carries (RT-01, D142). `node packages/bundle/scripts/build.ts` deploys this
package's production dependencies with a hoisted layout as the bundle's `lib/node_modules`, so
every Mostra package sits at `lib/node_modules/@mostra/<name>` as a sibling of the others, which is
how the runtime finds its worker, verify runner, shell and warm set, and how the SDK finds the
bundle it sits in. The warm set (`@mostra/warm`) is deployed apart, with its own isolated
`node_modules`, so artifacts resolve nothing but the warm packages.

## Invariants it owns

- **The bundle's Mostra packages are exactly these dependencies, plus `@mostra/warm`.** A package
  the bundle must ship goes here; the assembler fails when one of them isn't at the release's
  version.
- **`playwright-core` is listed directly** so it sits at `lib/node_modules/playwright-core`, the
  installer `bundle.json` names for the verify browser.

## Public interface

`package.json` `dependencies`.

## Tests to run

`node packages/bundle/scripts/build.ts --out <dir>`, then `sh packages/bundle/scripts/smoke.sh <archive>`
(docs/agents/build-a-runtime-bundle.md).

## Gotchas

- Adding a dependency here adds it to every bundle; the license audit checks the assembled tree
  (`node tools/license-audit/cli.ts --bundle <dir>`).
