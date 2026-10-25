---
"@mostra/protocol": minor
---

The runtime bundle's contract names Windows: `BUNDLE_PLATFORMS` gains `win32-x64` and `win32-arm64` (and `isWindowsBundle`), a bundle asset may be a Windows archive, and the setup marker records the root it was set up at (`root`, optional), since a Windows bundle's junctions point into it.
