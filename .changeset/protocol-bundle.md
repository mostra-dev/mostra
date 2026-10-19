---
"@mostra/protocol": minor
---

The runtime bundle's contract (RT-01, D142): `BundleInfo` (`bundle.json`), `BundleFiles` (`files.json`), `BundleBrowser`, `BundleAsset`, `BundlePins` (`bundles.json`) and `BundleSetup` (`.mostra-setup.json`) as Zod schemas with JSON Schema, `BUNDLE_PLATFORMS`, `BUNDLE_NAME`, `BUNDLE_SETUP_MARKER` and `bundleAssetName`, and three diagnostics: `MOSTRA_ENV_BUNDLE_INVALID`, `MOSTRA_ENV_BUNDLE_DOWNLOAD_FAILED` and `MOSTRA_ENV_BUNDLE_UNAVAILABLE`. `MOSTRA_ENV_BROWSER_MISSING`'s hint now names the bundle's setup.
