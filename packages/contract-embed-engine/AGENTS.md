# @mostra/contract-embed-engine

The embed-engine extension contract (D30, ROUND-3 §6.1, INTERFACES §14): the types an embed engine implements and `defineEmbedEngine`, which stamps a definition with this contract's name and version. Audience: plugin authors. Runs in: the browser (artifact pages). Imports nothing (tools/package-map.ts, D172).

## Invariants it owns

- **The stamp is the contract.** `defineEmbedEngine` returns the definition with `contract: { name, version }`, and Mostra loads a contribution only when its stamp names this contract at a version the running release serves (`stampServed` in `@mostra/protocol/plugin`). `VERSION` equals `package.json`'s version (a test), and `@mostra/protocol`'s `CONTRACT_VERSIONS` equals it after `node tools/release/versions.ts sync`.
- **Additive within a line.** At 0.x a minor may change shapes and a patch only adds optional members; from 1.0, minors only add. Optional features are capability names, never methods every implementation must grow.
- **Zero dependencies.** It never imports `@mostra/protocol` or anything else, so a plugin built against it pins nothing of Mostra's release.
- **`src/common.ts` is the same file in all six contracts** (a test compares it with `contract-exporter`'s): the stamp, contribution IDs and the shared context types.

## Public interface

`src/index.ts`; the API report is `etc/contract-embed-engine.api.md`.

## Tests to run

`pnpm --filter @mostra/contract-embed-engine test`, then `pnpm check --affected`.

## Gotchas

- Its version is its own, outside the release's fixed group (`.changeset/config.json`): a change to the contract takes a changeset for this package alone, and `versions.ts sync` carries the new version into `@mostra/protocol`.
- Change `src/common.ts` in all six packages at once.
