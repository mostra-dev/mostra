---
code: MOSTRA_ARTIFACT_BUNDLE_INVALID
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_ARTIFACT_BUNDLE_INVALID

Not a bundle this version can import. Severity: error. Phase: host.

## What it means

Importing a bundle checks it before it keeps anything: its `mostra-bundle.json`, that its version ID is the one its artifact ID and digests give, and that its builds and source snapshot have the digests it records. This bundle failed one of those checks, so a file was changed, lost or added after it was exported, or it isn't a bundle Mostra wrote.

## How to fix it

Export the version again from the home that published it, and copy the bundle's directory or archive whole.

## Hint

Export the bundle again with `mostra export <artifact> --as bundle`, and import the files it wrote unchanged.
