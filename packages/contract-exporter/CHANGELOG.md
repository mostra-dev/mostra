# @mostra/contract-exporter

## 0.1.0

### Minor Changes

- [#155](https://github.com/mostra-dev/mostra/pull/155) [`52b2f18`](https://github.com/mostra-dev/mostra/commit/52b2f18938645732aa11448f185329a0c7e03543) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - The six extension contracts, each its own package at its own version (D30): `defineEmbedEngine`, `defineExporter`, `defineVerifyCheck`, `defineAnchorProvider`, `defineConnector` (with `liveSource`) and `defineCliCommand` check a plugin's definition and stamp it with the contract's name and version, which Mostra reads from the loaded object to load it. No dependencies.
