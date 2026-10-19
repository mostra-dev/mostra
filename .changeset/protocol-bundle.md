---
"@mostra/protocol": minor
---

The runtime bundle's contract (RT-01, D142): `BundleInfo` (`bundle.json`), `BundleFiles` (`files.json`), `BundleBrowser`, `BundleAsset`, `BundlePins` (`bundles.json`) and `BundleSetup` (`.mostra-setup.json`) as Zod schemas with JSON Schema, `BUNDLE_PLATFORMS`, `BUNDLE_NAME`, `BUNDLE_SETUP_MARKER` and `bundleAssetName`, and four diagnostics: `MOSTRA_ENV_BUNDLE_INVALID`, `MOSTRA_ENV_BUNDLE_DOWNLOAD_FAILED`, `MOSTRA_ENV_BUNDLE_UNAVAILABLE` and `MOSTRA_ENV_NODE_UNSUPPORTED`. `MOSTRA_ENV_BROWSER_MISSING`'s hint now names the bundle's setup.
