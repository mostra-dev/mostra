---
"@mostra/protocol": minor
"@mostra/runtime": minor
"@mostra/cli": minor
---

Portable bundles: `mostra export <artifact> --out <path>` writes a published version (its builds, manifest, lockfile and source snapshot) as a directory or one `.tar.zst`, and `mostra run <bundle>` makes it the same version in another home, with the same artifact ID, version ID and digests, its server code running there. An import checks every digest, and that the manifest it records is the one its source declares, before it keeps anything (`MOSTRA_ARTIFACT_BUNDLE_INVALID`). New host protocol methods: `artifact/export` and `artifact/import`.
