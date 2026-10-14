# @mostra/warm

Audience: the runtime bundle. Runs in: nothing; this package has no code. Not published to npm.

## Purpose

The warm set (ROUND-3 §1.2, D91): the packages every artifact resolves without a `package.json`.
Each build's `node_modules` is a link to this package's `node_modules`, so an artifact that imports
`react`, `react-router`, `tailwindcss` or `@mostra/react` gets exactly the versions listed here, and
one copy of React.

## Invariants it owns

- **The warm set is this package's `dependencies`, and nothing else.** A package an artifact
  should resolve with no install goes here, pinned through the catalog. The runtime never imports
  these packages itself (REPO_STANDARDS §3).
- **One React.** Every warm package that needs React takes it as a peer, so the link holds a single
  copy.

## Public interface

`package.json` `dependencies`. The runtime finds this directory as the sibling `warm` of its own
package root, or through `MOSTRA_WARM_DIR`, and writes the resolved versions into each version's
`lock.yaml`, so changing the warm set changes the version identity of later publishes (VR-01).
Its `node_modules` is the pre-built warm layout (D95): an artifact that imports only warm packages
builds against it directly, and every on-demand lock layout in the home's `deps/locks` links it
through a `warm` symlink, so an on-demand package's peers resolve to these copies.

## Tests to run

The runtime's build tests use it: `pnpm --filter @mostra/runtime test`, then
`pnpm --filter @mostra/runtime test:integration`.

## Gotchas

- WP-11 ships this layout in the runtime bundle; WP-18 and WP-19 build the kit's wrappers on these
  packages. Packages outside the warm set (maps, 3D, Excalidraw) install on demand (ROUND-3 §1.2).
- Add a package through the catalog in `pnpm-workspace.yaml`, then `pnpm install`; the license
  audit covers it like any other dependency, because this package ships. A new package that needs
  React must take it as a peer, or it would bring a second React.
