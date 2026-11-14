---
"@mostra/contract-embed-engine": minor
"@mostra/contract-exporter": minor
"@mostra/contract-verify-check": minor
"@mostra/contract-anchor-provider": minor
"@mostra/contract-connector": minor
"@mostra/contract-cli-command": minor
---

The six extension contracts, each its own package at its own version (D30): `defineEmbedEngine`, `defineExporter`, `defineVerifyCheck`, `defineAnchorProvider`, `defineConnector` (with `liveSource`) and `defineCliCommand` check a plugin's definition and stamp it with the contract's name and version, which Mostra reads from the loaded object to load it. No dependencies.
