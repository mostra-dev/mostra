---
"@mostra/cli": patch
"@mostra/conformance": patch
---

On Windows, `mostra open` writes its launch page under the user's own profile, never under a `%TEMP%` that other users may read. The conformance kit opens an instance's pipe through the SDK's `connectControl`, as every other client does.
